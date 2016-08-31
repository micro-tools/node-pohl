"use strict";

const expect = require("expect.js");

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
        log: true,
        timeout: 800
    };

    const p = new Pohl(config);

    it("should be able to setup a receiver", function(done){

        const receiveTask = (err, task, callback) => {

            expect(err).to.be.equal(undefined);

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

                expect(err).to.be.equal(undefined);
                expect(typeof taskResult).to.be.equal("object");
                expect(taskResult.okay).to.be.equal("worked");
                console.log(taskResult.okay);

                done();
            }
        );
    });


    it("should get timeout on no answer", function(){

        let aTask = {
            make: "something",
            with: "this thing",
            scenario: "timeout"
        };

        p.sendTask(aTask,
            (err, taskResult) => {

                expect(err).not.to.be.equal(undefined);
                expect(taskResult).to.be.equal(undefined);
                console.log(err);

                done();
            }
        );
    });

    it("should error on callback for error in task process", function(){

        let aTask = {
            make: "something",
            with: "this thing",
            scenario: "error"
        };

        p.sendTask(aTask,
            (err, taskResult) => {

                expect(err).not.to.be.equal(undefined);
                expect(taskResult).to.be.equal(undefined);
                expect(err).to.be.equal("error");
                console.log(err);

                done();
            }
        );
    });

    it("should be fast", function(){

        let startT = Date.now();

        let aTask = {
            make: "something",
            with: "this thing"
        };

        p.sendTask(aTask,
            (err, taskResult) => {

                let endT = Date.now();

                expect(err).to.be.equal(undefined);
                expect(taskResult).not.to.be.equal(undefined);
                expect(taskResult.okay).to.be.equal("worked");

                let diff = endT - startT;
                console.log("took: " + diff + "ms.");
                expect(diff < 5).to.be.equal(true);

                done();
            }
        );
    });

});