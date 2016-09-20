"use strict";

const uuid = require("uuid");
const log4bro = require("log4bro");
const EventEmitter = require("events");

const CacheWrapper = require("./redis/CacheWrapper.js");
const RedisMessage = require("./redis/RedisMessage.js");
const DistLock = require("./redis/DistLock.js");

const PRODUCTION_ENV = "production";
const FNULL = () => {};

class Pohl extends EventEmitter {

    constructor(config = { topic: "pohl", log: false, timeout: 1000, cache: { redis: null }, circuitCheck: 2000, timeoutThreshold: 5}){

        super();

        if(!global.MLOG){

            const options = {
                "productionMode": false,
                "logDir": "logs",
                "skipEnhance": true,
                "silence": !config.log,
                "loggerName": "dev",
                "dockerMode": false,
                "varKey": "MLOG",
                "level": "DEBUG",
                "serviceName": "internal-node-pohl-logger"
            };

            var env = process.env.NODE_ENV || 'dev';
            if(env === PRODUCTION_ENV){
                options.silence = true;
            }

            const logger = new log4bro(options);
        }

        this.topic = config.topic;
        this.timeout = config.timeout;

        this.redis = new CacheWrapper(config);
        this.lock = new DistLock(this.redis);

        var confStringValue = JSON.stringify(config);
        var incConfig = JSON.parse(confStringValue);
        var outConfig = JSON.parse(confStringValue);

        incConfig.topic = "inc:" + config.topic;
        outConfig.topic = "out:" + config.topic;

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

        this._runCircuitBreakerTimeoutCheck(config.circuitCheck || 2000, config.timeoutThreshold || 10);
    }

    isSenderCircuitOpen(){
        return this._circuitOpen;
    }

    _runCircuitBreakerTimeoutCheck(circuitCheck = 2000, timeoutThreshold = 10){
        this._cbIntv = setInterval(() => {

            if(this._timeoutCount > timeoutThreshold){
                MLOG.info("circuit breaker tripped, circuit open.");
                this._circuitOpen = true;
                this._timeoutCount = 0;
                return;
            }

            this._timeoutCount = 0;
            if(this._circuitOpen){
                MLOG.info("circuit closed again.");
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

            MLOG.debug("receiver returned a task: " + message);
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
            MLOG.error("[s] received bad message format: " + _message);
            return;
        }

        if(message.i === undefined ||
            message.p === undefined ||
            message.o === undefined){
            MLOG.error("[s] received bad message content: " + _message);
            return;
        }

        //check if that message exists on this sender
        //because there a high chance, some1 else sent it

        if(!this.stack[message.i]){
            MLOG.debug(message.i + " is not a task send from this sender, or it has timed out already.");
            return;
        } else {
            MLOG.debug(message.i + " has a task send from this sender.");
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
     * @param message
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
            MLOG.error(err);
            return callback(err);
        }

        if(message.i === undefined ||
            message.p === undefined ||
            message.o === undefined){
            let err = "[r] received bad message content: " + _message;
            MLOG.error(err);
            return callback(err);
        }

        let lockId = this.topic + ":" + message.i;

        this.lock.lockOrWait(lockId, (err, gotLock) => {

            if(err){
                MLOG.error("failed ot get lock because of error: " + err);
                return;
            }

            if(!gotLock){
                MLOG.debug("did not get the lock to process this task.");
                return;
            }

            MLOG.debug("received task and got lock for id: " + message.i + " on topic: " + this.topic);

            //message is an object, parse it
            if(message.o){
                message.p = JSON.parse(message.p);
            }

            //prepare callback that can be used to return the task
            let returnTask = (err, payload) => {

                //fire & forget delete
                this.lock.removeLock(lockId, FNULL);

                if(err){
                    message.e = "" + err;
                    return this.incQueue.publishOnChannel(JSON.stringify(message));
                }

                let payloadIsObject = false;

                if(typeof payload !== "string") {
                    payload = JSON.stringify(payload);
                    payloadIsObject = true;
                }

                message.p = payload;
                message.o = payloadIsObject;

                this.incQueue.publishOnChannel(JSON.stringify(message));
            };

            callback(null, message.p, returnTask);
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

        this.outQueue.autoSubscribeChannel((message) => {

            MLOG.debug("received message from sender.");
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
            MLOG.error(err);
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
            MLOG.info("sendTask is missing callback, i hope you sure know what you are doing.");
            callback = FNULL;
        }

        //creation of a new message

        let payloadIsObject = false;

        if(typeof payload !== "string") {
            payload = JSON.stringify(payload);
            payloadIsObject = true;
        }

        let taskId = uuid.v4();

        MLOG.debug("sending task with id: " + taskId + " on topic: " + this.topic);
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
        this.redis.close(cb);
    }
}

module.exports = Pohl;