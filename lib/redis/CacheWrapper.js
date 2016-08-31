"use strict";

const ioredis = require("ioredis");

class CacheWrapper {

    /***
     * requires config.cache.redis configuration
     * metrics object events are: err, set, get, exp, del
     * @param config
     * @param metricCallbacks
     */
    constructor(config, metricCallbacks = null){

        this.redis = null;
        this.metrics = metricCallbacks;

        this.initRedis(config);
    }

    initRedis(_config) {

            var config = _config.cache;

            //make sure a single redis connection is used
            if (CacheWrapper.redisConnection) {
                MLOG.info("Reusing redis connection");
                this.redis = CacheWrapper.redisConnection;
                return;
            }

            if(!config || !config.redis){
                MLOG.error("Missing redis config: " + JSON.stringify(config));
                throw new Error("Redis configuration is missing in config file.");
            }

            if(config.redis.sentinels){
                MLOG.warn("Connecting to redis sentinels: " + JSON.stringify(config.redis.sentinels));
            }

            config.redis.retryStrategy = times => {
                var delay = Math.min(times * 2000, 30000);
                return delay;
            };

            config.redis.sentinelRetryStrategy = times => {
                var delay = Math.min(times * 2000, 30000);
                return delay;
            };

            this.redis = new ioredis(config.redis);
            this.redis.on("error", this._onError.bind(this));

            CacheWrapper.redisConnection = this.redis;
    }

    _onError(err){

        if (this.metrics) {
            this.metrics["err"]();
        }

        MLOG.error(err);
    }

    set(key, val, ttl, callback) {

        MLOG.debug("Cache setting: " + key + " with ttl: " + ttl);

        if (this.metrics) {
            this.metrics["set"]();
        }

        this.redis.set(key, val, (err, res) => {

            if(err){
                return callback(err);
            }

            if (!ttl || typeof ttl === "undefined") {
                return callback(err, res);
            }

            this.expire(key, ttl, callback);
        });
    }

    get(key, callback) {

        MLOG.debug("Cache getting: " + key);

        if(this.metrics){
            this.metrics["get"]();
        }

        this.redis.get(key, callback);
    }

    del(key, callback){

        MLOG.debug("Cache deleting: " + key);

        if(this.metrics){
            this.metrics["del"]();
        }

        this.redis.del(key, callback);
    }

    expire(key, ttl, callback = null){

        MLOG.debug("Cache expiring (ttl set): " + key + " in " + ttl);

        if (this.metrics) {
            this.metrics["exp"]();
        }

        this.redis.expire(key, ttl);

        if (callback) {
            callback(null, true);
        }
    }

    getBuffer(key, callback) {

        MLOG.debug("Cache getting buffer: " + key);

        if(this.metrics){
            this.metrics["get"]();
        }

        this.redis.getBuffer(key, callback);
    }

    setObject(key, object, ttl, callback) {
        this.set(key, JSON.stringify(object), ttl, callback);
    }

    getObject(key, callback) {
        this.get(key, (err, value) => {

            if (err){
                return callback(err);
            }

            if (!value){
                return callback(null, null);
            }

            var object = null;
            try {
                object = JSON.parse(value);
            } catch (err) {
                return callback(err);
            }

            if (object === null) {
                MLOG.error("Failed to parse cache object, its null for " + key);
            }

            callback(null, object);
        });
    };
}

module.exports = CacheWrapper;