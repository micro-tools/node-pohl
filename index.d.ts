/* tslint:disable:max-classes-per-file */
import { EventEmitter } from "events";
import { Redis, RedisOptions } from "ioredis";
import * as Redlock from "redlock";

interface IMetricCallbacks {
    err: () => void;
    sub: () => void;
    pub: () => void;
    msg: () => void;
}
declare class RedisMessage {
    /**
     * Helper to send debug messages over the potentially registered debugger
     */
    public static DEBUG(msg: string): void;
    /**
     * Helper to send info messages over the potentially registered logger
     */
    public static INFO(msg: string): void;
    public static getRandomInt(min: number, max: number): number;
    /**
     * Configuration used for Redis
     */
    public redisConfig: RedisOptions;
    public metrics: IMetricCallbacks | null;
    /**
     * Name of the channel / topic to use
     */
    public channel: string;
    /**
     * Time to wait for auto reconnection
     */
    public autoReconnectInterval: number;
    /**
     * IoRedis instance for the publisher
     */
    public pub: Redis | null;
    /**
     * IoRedis instance for the subscriber
     */
    public sub: Redis | null;
    /***
     * requires config.cache.redis configuration
     * metrics object events are: err, sub, pub, msg
     */
    constructor(config: IPohlConfiguration, metricCallbacks?: IMetricCallbacks | null);
    public initRedisConfig(config: IPohlConfiguration): RedisOptions;
    public autoSubscribeChannel(triggerEvent: (...args: any[]) => any, callback?: (() => void) | null): void;
    public publishOnChannel(message: string): void;
    public close(): void;
}

interface IPohlConfiguration {
    autoReconnectInterval?: number;
    cache: {
        redis: RedisOptions | null;
    };
    circuitCheck: number;
    debugger?: (msg: string, ...args: any[]) => any;
    logger?: (msg: string, ...args: any[]) => any;
    timeout: number;
    timeoutThreshold: number;
    topic: string;
}

interface IPohlMessage {
    /**
     * ID of the message
     */
    i: string;
    /**
     * Object mode of the payload
     */
    o: boolean;
    /**
     * Payload itself
     */
    p: any;
}
declare class Pohl extends EventEmitter {
    /**
     * Helper to send logs messages over the potentially registered logger
     */
    public static LOG(msg: string): void;
    /**
     * Helper to send debug messages over the potentially registered debugger
     */
    public static DEBUG(msg: string): void;

    public stack: {
        [name: string]: (err?: Error | null, result?: any) => void;
    };
    public topic: string;
    public timeout: number;
    public lock: Redlock;
    public lockTTL: number;
    /**
     * Incoming message Queue
     */
    public incQueue: RedisMessage;
    /**
     * Outgoing message Queue
     */
    public outQueue: RedisMessage;
    constructor(config?: IPohlConfiguration);
    /**
     * Method to check if the receiver is paused
     */
    public isPaused(): boolean;
    /**
     * Method to pause the receiver
     */
    public pause(): void;
    /**
     * Method to resume the receiver
     */
    public resume(): void;
    /**
     * create a task receiver on this pohl object, to receive incoming tasks from other instances
     * that use sendTask on the same topic name. make sure to pass an receiving event (taskEvent)
     * that will be called with the task and a callback to return it to the sender
     */
    public setupTaskReceiver(taskEvent: (...arg: any[]) => void, done?: (() => void)): void;
    /**
     * send a task to any receiver that is listening on the queue,
     * if the receiver does return your task before it times out,
     * you will receive the task result in the provided callback,
     * you can also fire & forget this function
     */
    public sendTask(payload: any, callback?: ((err?: Error | null, message?: any) => void)): void;
    public getStackSize(): number;
    public close(cb: () => void): void;
    public isSenderCircuitOpen(): boolean;
}

export = Pohl;
