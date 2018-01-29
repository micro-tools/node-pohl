"use strict";

const uuid = require("uuid");
const EventEmitter = require("events");
const ioredis = require("ioredis");
const Redlock = require("redlock");

const RedisMessage = require("./redis/RedisMessage.js");
const FNULL = () => {};

class Pohl extends EventEmitter {

    constructor(config = { topic: "pohl", logger: null, debugger: null, timeout: 1000, cache: { redis: null }, circuitCheck: 2000, timeoutThreshold: 5}){

        super();

        this.topic = config.topic;
        this.timeout = config.timeout;

      const redisConnection = new ioredis(config.cache.redis);
      redisConnection.on("error", err => Pohl.LOG("[Pohl] redis-error: " + JSON.stringify(err)));

      this.lock = new Redlock(
            [ redisConnection],
            {
                driftFactor: 0.01,
                retryCount: 0,
                retryDelay: 200
            }
        );

        if(typeof config.logger === "function"){
            Pohl._logger = config.logger;
        }

        if(typeof config.debugger == "function"){
            Pohl._debugger = config.debugger;
        }

        this.lock.on("clientError", err => {
            Pohl.LOG("redlock error: " + err);
        });

        this.lockTTL = 250;

        var confStringValue = JSON.stringify(config);
        var incConfig = JSON.parse(confStringValue);
        var outConfig = JSON.parse(confStringValue);

        incConfig.topic = "inc:" + config.topic;
        outConfig.topic = "out:" + config.topic;

        incConfig.debugger = config.debugger;
        outConfig.debugger = config.debugger;

        incConfig.logger = config.logger;
        outConfig.logger = config.logger;

        //duplex on 2 channels
        this.incQueue = new RedisMessage(incConfig);
        this.outQueue = new RedisMessage(outConfig);

        //callback stack
        this.stack = {};

        this._senderSetupDone = false;
        this._receiverSetupDone = false;

        this._timeoutCount = 0;
        this._circuitOpen = false;
        this._cbIntv = null;

        this._paused = false;

        this._runCircuitBreakerTimeoutCheck(config.circuitCheck || 2000, config.timeoutThreshold || 10);
    }

    static LOG(msg){
        if(typeof Pohl._logger === "function"){
            Pohl._logger(msg);
        }
    }

    static DEBUG(msg){
        if(typeof Pohl._debugger === "function"){
            Pohl._debugger(msg);
        }
    }

    isPaused(){
        return this._paused;
    }

    /**
     * pauseable receiver
     */
    pause(){
        this._paused = true;
    }

    resume(){
        this._paused = false;
    }

    isSenderCircuitOpen(){
        return this._circuitOpen;
    }

    _runCircuitBreakerTimeoutCheck(circuitCheck = 2000, timeoutThreshold = 10){
        this._cbIntv = setInterval(() => {

            if(this._timeoutCount > timeoutThreshold){
                Pohl.LOG("circuit breaker tripped, circuit open.");
                this._circuitOpen = true;
                this._timeoutCount = 0;
                return;
            }

            this._timeoutCount = 0;
            if(this._circuitOpen){
                Pohl.LOG("circuit closed again.");
                this._circuitOpen = false;
            }

        }, circuitCheck);
    }

    _stopCircuitBreakerTimeoutCheck(){
        if(this._cbIntv){
            clearInterval(this._cbIntv);
        }
    }

    _setupTaskSender(done = null){

        if(this._senderSetupDone){
            throw new Error("sender setup already ran.");
        }

        this.incQueue.autoSubscribeChannel((message) => {

            Pohl.DEBUG("receiver returned a task: " + message);
            this._onTaskReturned(message);

        }, () => {

            this._senderSetupDone = true;

            if(done){
                done();
            }
        });
    }

    /**
     * internal function that is called right when a task has been worked on
     * by the receiver and the receiver published the task back on the inc queue
     * @private
     * @param _message
     */
    _onTaskReturned(_message){

        let message = null;
        try {
            message = JSON.parse(_message);
        } catch(e){
            //empty
        }

        if(!message || typeof message !== "object"){
            Pohl.LOG("[s] received bad message format: " + _message);
            return;
        }

        if(message.i === undefined ||
            message.p === undefined ||
            message.o === undefined){
            Pohl.LOG("[s] received bad message content: " + _message);
            return;
        }

        //check if that message exists on this sender
        //because there a high chance, some1 else sent it

        if(!this.stack[message.i]){
            Pohl.DEBUG(message.i + " is not a task send from this sender, or it has timed out already.");
            return;
        } else {
            Pohl.DEBUG(message.i + " has a task send from this sender.");
        }

        //if an error is present, we just call right away and pass it to the callback in the stack
        if(message.e){
            return this.stack[message.i](message.e);
        }

        //message is an object, parse it
        if(message.o){
            message.p = JSON.parse(message.p);
        }

        //all done, parse the result payload back to the callback on the stack
        this.stack[message.i](null, message.p);
    }

    /**
     * internal function that is called right when a task has been received
     * on the out queue and has to be prepared for a potential return using
     * the params that are passed to the callback (which is the taskEvent)
     * @param _message
     * @param callback
     * @private
     */
    _onTaskReceive(_message, callback){

        let message = null;
        try {
            message = JSON.parse(_message);
        } catch(e){
            //empty
        }

        if(!message || typeof message !== "object"){
            let err = "[r] received bad message format: " + _message;
            Pohl.LOG(err);
            return callback(err);
        }

        if(message.i === undefined ||
            message.p === undefined ||
            message.o === undefined){
            let err = "[r] received bad message content: " + _message;
            Pohl.LOG(err);
            return callback(err);
        }

        const lockId = this.topic + ":" + message.i;

        this.lock.lock(lockId, this.lockTTL).then(lock => {

            Pohl.DEBUG("received task and got lock for id: " + message.i + " on topic: " + this.topic);

            //message is an object, parse it
            if(message.o){
                message.p = JSON.parse(message.p);
            }

            //prepare callback that can be used to return the task
            let returnTask = (err, payload) => {

                if(err){
                    message.e = "" + err;
                    lock.unlock();
                    return this.incQueue.publishOnChannel(JSON.stringify(message));
                }

                let payloadIsObject = false;

                if(typeof payload !== "string") {
                    payload = JSON.stringify(payload);
                    payloadIsObject = true;
                }

                message.p = payload;
                message.o = payloadIsObject;

                lock.unlock();
                this.incQueue.publishOnChannel(JSON.stringify(message));
            };

            callback(null, message.p, returnTask);
        }).catch(err => {

            if(err){
                Pohl.DEBUG("did not get lock or failed during error: " + err);
            }
        });
    }

    /**
     * create a task receiver on this pohl object, to receive incoming tasks from other instances
     * that use sendTask on the same topic name. make sure to pass an receiving event (taskEvent)
     * that will be called with the task and a callback to return it to the sender
     * @param taskEvent
     * @param done
     */
    setupTaskReceiver(taskEvent, done = null){

        if(!taskEvent || typeof taskEvent !== "function"){
            throw new Error("task event has to be a function.");
        }

        if(this._receiverSetupDone){
            throw new Error("receiver setup already ran.");
        }

        this.outQueue.autoSubscribeChannel(message => {

            if(this._paused){
                Pohl.DEBUG("received message but receiver is paused.");
                return;
            }

            Pohl.DEBUG("received message from sender " + message);
            this._onTaskReceive(message, taskEvent);

        }, () => {

            this._receiverSetupDone = true;

            if(done){
                done();
            }
        });
    }

    /**
     * send a task to any receiver that is listening on the queue,
     * if the receiver does return your task before it times out,
     * you will receive the task result in the provided callback,
     * you can also fire & forget this function
     * @param payload
     * @param callback
     */
    sendTask(payload, callback = null){

        if(this._circuitOpen){
            return callback("circuit breaker is open.");
        }

        if(payload === undefined){
            let err = "your payload is undefined, which wont be sent.";
            Pohl.LOG(err);
            if(callback){
                callback(err);
            }
            return;
        }

        //recursive setup, on first task that has be to send
        if(!this._senderSetupDone){
            this._setupTaskSender(() => {
               this.sendTask(payload, callback);
            });
            return;
        }

        if(!callback){
            Pohl.LOG("sendTask is missing callback, i hope you sure know what you are doing.");
            callback = FNULL;
        }

        //creation of a new message

        let payloadIsObject = false;

        if(typeof payload !== "string") {
            payload = JSON.stringify(payload);
            payloadIsObject = true;
        }

        let taskId = uuid.v4();

        Pohl.DEBUG("sending task with id: " + taskId + " on topic: " + this.topic);
        this.emit("metric", "send", "out");
        const sendStart = Date.now();

        let task = JSON.stringify({
            i: taskId,
            p: payload,
            o: payloadIsObject
        });

        let timeout = setTimeout(() => {

            this._timeoutCount++;
            this.emit("metric", "send", "timeout");
            //remove task from stack
            delete this.stack[taskId];
            callback("task ran into timeout after " + this.timeout + "ms.");

        }, this.timeout || 1000);

        //write callback to stack
        this.stack[taskId] = (err, message) => {

            const sendEnd = Date.now();
            this.emit("metric", "send", "receive");
            this.emit("metric", "duration", (sendEnd - sendStart));

            if(timeout){
                clearTimeout(timeout);
                callback(err, message);
                delete this.stack[taskId];
            }
        };

        this.outQueue.publishOnChannel(task);
    }

    getStackSize(){
        return Object.keys(this.stack).length;
    }

    close(cb){
        this._stopCircuitBreakerTimeoutCheck();
        this.incQueue.close();
        this.outQueue.close();
        cb();
    }
}

module.exports = Pohl;
