"use strict";

const ioredis = require("ioredis");

const AUTO_RESUB_TIMEOUT = 1000 * 60 * 5; //5 minutes

class RedisMessage {

    /***
     * requires config.cache.redis configuration
     * metrics object events are: err, sub, pub, msg
     * @param config
     * @param metricCallbacks
     */
    constructor(config, metricCallbacks = null){

        this.redisConfig = this.initRedisConfig(config);
        this.metrics = metricCallbacks;

        this.channel = config.topic;
        this.autoReconnectInterval = typeof config.autoReconnectInterval === "undefined" ?
            AUTO_RESUB_TIMEOUT : config.autoReconnectInterval;

        if(this.autoReconnectInterval !== null){
            //attach random milliseconds to interval, to makre sure that they do not run at the same time
            //as other instances to allow 0 fails/timeouts during auto re-sub
            this.autoReconnectInterval += RedisMessage.getRandomInt(100, 10000);
        }

        //autoReconnectInterval -> null = not used, undefined = default value, else = value used

        if(!this.channel || this.channel === "" || this.channel === " "){
            throw new Error("Redis Messaging channel is not set or empty.");
        }

        //we will create these on demand
        this.pub = null;
        this.sub = null;

        this._intv = null;
    }

    static getRandomInt(min, max) {
        min = Math.ceil(min);
        max = Math.floor(max);
        return Math.floor(Math.random() * (max - min +1)) + min;
    }

    _setupPublish(){

        if(this.pub){
            return;
        }

        this.pub = new ioredis(this.redisConfig);

        if(!this.pub){
            throw new Error("Failed to setup pub redis for redis messaging.");
        }

        this.pub.on("error", this._onError.bind(this));

        LOG.info("publishing ready for " + this.channel);
    }

    /**
     * creates a new connection (for this.sub) will terminate old connection if present
     * @private
     */
    _setupSubscribe(){

        if(this.sub){
            this.sub.disconnect();
            this.sub = null;
        }

        this.sub = new ioredis(this.redisConfig);

        if(!this.sub){
            throw new Error("Failed to setup sub redis for redis messaging.");
        }

        this.sub.on("error", this._onError.bind(this));

        LOG.info("subscription ready for " + this.channel);
    }

    initRedisConfig(config){

        if(!config || !config.cache || !config.cache.redis){
            LOG.error("node-pohl: Missing redis conf: " + JSON.stringify(config.cache));
            throw new Error("Redis configuration is missing in config file.");
        }

        config.cache.redis.retryStrategy = (times) => {
            var delay = Math.min(times * 2000, 30000);
            LOG.error("node-pohl: Redis connection failed => " + times);
            return delay;
        };

        config.cache.redis.sentinelRetryStrategy = (times) => {
            var delay = Math.min(times * 2000, 30000);
            LOG.error("node-pohl: Sentinel connection failed => " + times);
            return delay;
        };

        return config.cache.redis;
    }

    _onError(err){

        if (this.metrics) {
            this.metrics["err"]();
        }

        LOG.error(err);
    }

    _runAutoReSubscribe(setupClosure){

        setupClosure();

        if(this.autoReconnectInterval === null){
            LOG.warn("node-pohl: auto-resubscribe is not active.");
            return;
        }

        LOG.info("node-pohl: auto-resubscribe is active.")

        this._intv = setInterval(() => {

            LOG.info("node-pohl: auto-resubscribe running.");
            setupClosure();

        }, this.autoReconnectInterval);
    }

    autoSubscribeChannel(triggerEvent, callback = null){

        if(!triggerEvent || typeof triggerEvent !== "function"){
            LOG.error("TriggerEvent should be a valid function, for redis messages to be received.");
            return;
        }

        let callbackCalled = false;

        this._runAutoReSubscribe(() => {

            this._setupSubscribe();

            this.sub.subscribe(this.channel, (err, count) => {

                if(err){
                    throw new Error(err + "");
                }

                if (this.metrics) {
                    this.metrics["sub"]();
                }

                if(count !== 1){
                    throw new Error("Failed to subscribe to redis channel: " + this.channel);
                }

                LOG.info("Subscribed to redis channel: " + this.channel);

                this.sub.on("message", (channel, message) => {

                    switch(channel) {

                        case this.channel:

                            LOG.debug("received message on channel: " + channel);

                            if (this.metrics) {
                                this.metrics["msg"]();
                            }

                            triggerEvent(message);
                            break;

                        default: return;
                    }
                });

                if(callback && !callbackCalled){
                    callbackCalled = true;
                    callback();
                }
            });
        });
    }

    publishOnChannel(message){

        this._setupPublish();

        LOG.debug("publishing redis message on channel:" + this.channel);

        if (this.metrics) {
            this.metrics["pub"]();
        }

        this.pub.publish(this.channel, message);
    }

    close(){

        if(this._intv){
            clearInterval(this._intv);
        }

        if(this.pub){
            this.pub.disconnect();
        }

        if(this.sub){
            this.sub.disconnect();
        }
    }
}

module.exports = RedisMessage;