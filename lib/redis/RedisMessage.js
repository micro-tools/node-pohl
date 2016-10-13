"use strict";

const ioredis = require("ioredis");

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

        if(!this.channel || this.channel === "" || this.channel === " "){
            throw new Error("Redis Messaging channel is not set or empty.");
        }

        //we will create these on demand
        this.pub = null;
        this.sub = null;
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

    _setupSubscribe(){

        if(this.sub){
            return;
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
            LOG.error("Missing redis conf: " + JSON.stringify(config.cache));
            throw new Error("Redis configuration is missing in config file.");
        }

        config.cache.redis.retryStrategy = (times) => {
            var delay = Math.min(times * 2000, 30000);
            return delay;
        };

        config.cache.redis.sentinelRetryStrategy = (times) => {
            var delay = Math.min(times * 2000, 30000);
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

    autoSubscribeChannel(triggerEvent, callback = null){

        if(!triggerEvent || typeof triggerEvent !== "function"){
            LOG.error("TriggerEvent should be a valid function, for redis messages to be received.");
            return;
        }

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

            if(callback){
                callback();
            }
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
        
        if(this.pub){
            this.pub.disconnect();
        }

        if(this.sub){
            this.sub.disconnect();
        }
    }
}

module.exports = RedisMessage;