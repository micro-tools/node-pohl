"use strict";

const LOCK_VALUE = 1;
const LAB_VALUE = 1;

class DistLock {

    /**
     * requires a CacheWrapper.js instance (therefore no metrics)
     * requires a small conf object that sets redis key prefixes
     * @param cacheWrapper
     * @param config
     */
    constructor(cacheWrapper = null, config = { lockPrefix: "np:lock", labPrefix: "np:lab" }){

        if(!cacheWrapper){
            throw new Error("cache wrapper instance is missing.");
        }

        this.LOCK = config.lockPrefix;
        this.LAB = config.labPrefix;

        this.cacheWrapper = cacheWrapper;

        this.maxLockLifeTime = 8; //8 seconds (make sure this is higher than the circuit-breaker timeout)
        this.maxLabLifeTime = 10 * 60 * 3; //30 minutes
    }

    isLockable(id, callback){

        this.cacheWrapper.get(this.LAB + id, (err, res) => {

            if(err || !res){
                return callback(null, false);
            }

            return callback(null, true);
        });
    }

    setLockable(id, callback){

        this.cacheWrapper.set(this.LAB + id, LAB_VALUE, (err, res) => {

            if(err){
                return callback(err);
            }

            if(res === 0){
                MLOG.error("failed to set lock-ability for id " + id);
                return callback(null, false);
            }

            this.cacheWrapper.expire(this.LAB + id, this.maxLabLifeTime, (err) => {

                if (err) {
                    return callback(err);
                }

                callback(null, true);
            });
        });
    }

    lockOrWait(id, callback) {

        this.cacheWrapper.redis.setnx(this.LOCK + id, LOCK_VALUE, (err, res) => {

            if (res === 0) {
                MLOG.debug("were not able to lock for id " + id);
                return callback(null, false);
            }

            this.cacheWrapper.expire(this.LOCK + id, this.maxLockLifeTime, (err) => {

                if (err) {
                    return callback(err);
                }

                callback(null, true);
            });
        });
    }

    removeLock(id, callback) {

        this.cacheWrapper.redis.exists(this.LOCK + id, (err, res) => {

            if (res !== 1) {
                return callback("cannot unlock a non existing lock");
            }

            this.cacheWrapper.del(this.LOCK + id, (err, res) => {

                if (err) {
                    return callback(err);
                }

                callback(null, true);
            });
        });
    }
}

module.exports = DistLock;