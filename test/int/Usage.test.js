"use strict";

const expect = require("expect.js");
const async = require("async");

const Pohl = require("./../../index.js");

describe("Usage Integration", function(){

    const config = {
        topic: "pohl-test",
        cache: {
            redis: {
                port: 6379,
                host: "127.0.0.1",
                family: 4,
                db: 0,
                keyPrefix: "pohl:"
            }
        },
        log: false,
        timeout: 800
    };

    const p = new Pohl(config);

    let receivedMetricEvent = false;

    p.on("metric", (type, value) => {
        if(!receivedMetricEvent && type === "duration"){
            console.log("duration: " + value);
            receivedMetricEvent = true;
        }
    });

    it("should be able to setup a receiver", function(done){

        const receiveTask = (err, task, callback) => {

            expect(err).to.be.equal(null);

            if(task.scenario){
                switch(task.scenario){

                    case "timeout":
                        //empty
                        break;

                    case "error":
                        callback("error");
                        break;

                    default: break;
                }
                return;
            }

            console.log("got task: " + JSON.stringify(task));
            task.okay = "worked";

            callback(null, task);
        };

        p.setupTaskReceiver(receiveTask, () => {
            done();
        });
    });

    it("should return correct taskResult", function(done){

        let aTask = {
            make: "something",
            with: "this thing"
        };

        p.sendTask(aTask,
            (err, taskResult) => {

                expect(err).to.be.equal(null);
                expect(typeof taskResult).to.be.equal("object");
                expect(taskResult.okay).to.be.equal("worked");
                console.log(taskResult.okay);

                done();
            }
        );
    });


    it("should get timeout on no answer", function(done){

        let aTask = {
            make: "something",
            with: "this thing",
            scenario: "timeout"
        };

        p.sendTask(aTask,
            (err, taskResult) => {

                expect(err).not.to.be.equal(null);
                expect(taskResult).to.be.equal(undefined);
                console.log(err);

                done();
            }
        );
    });

    it("should error on callback for error in task process", function(done){

        let aTask = {
            make: "something",
            with: "this thing",
            scenario: "error"
        };

        p.sendTask(aTask,
            (err, taskResult) => {

                expect(err).not.to.be.equal(null);
                expect(taskResult).to.be.equal(undefined);
                expect(err).to.be.equal("error");
                console.log(err);

                done();
            }
        );
    });

    it("should be fast", function(done){

        let startT = Date.now();

        let aTask = {
            make: "something",
            with: "this thing"
        };

        p.sendTask(aTask,
            (err, taskResult) => {

                let endT = Date.now();

                expect(err).to.be.equal(null);
                expect(taskResult).not.to.be.equal(undefined);
                expect(taskResult.okay).to.be.equal("worked");

                let diff = endT - startT;
                console.log("took: " + diff + "ms.");
                expect(diff <= 5).to.be.equal(true);

                done();
            }
        );
    });

    it("should see an empty stack", function(done){

        setTimeout(() => {

            expect(p.getStackSize()).to.be.equal(0);
            done();

        }, 1000);
    });

    it("should trip circuit breaker with more than 10 timeouts in 2 seconds", function(done){

        this.timeout(4000);

        expect(p.isSenderCircuitOpen()).to.be.equal(false);

        const causeTimeout = (i, cb) => {

            let aTask = {
                make: "something",
                with: "this thing",
                scenario: "timeout"
            };

            p.sendTask(aTask,
                (err, taskResult) => {
                    cb(null, i);
                }
            );
        };

        const gos = [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15];

        async.map(gos, causeTimeout, (err, res) => {
            expect(err).to.be.equal(null);
            expect(res).not.to.be.equal(null);
            setTimeout(() => {
                expect(p.isSenderCircuitOpen()).to.be.equal(true);
                done();
            }, 2000);
        });
    });

    it("should close the circuit breaker again after a few seconds", function(done){
        this.timeout(3000);
        setTimeout(() => {
            expect(p.isSenderCircuitOpen()).to.be.equal(false);
            done();
        }, 2100);
    });

    it("should have received at least one metric event", function(done){
       expect(receivedMetricEvent).to.be.equal(true);
        done();
    });

    it("should be able to close the connections", function(done){
        p.close(() => {
           done();
        });
    });
});