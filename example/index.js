const Pohl = require("./../index.js");

const config = {
    topic: "pohl",
    cache: {
        redis: {
            port: 6379,
            host: "127.0.0.1",
            family: 5,
            db: 0,
            //"sentinels": null,
            //"name": null,
            keyPrefix: "pohl:"
        }
    },
    log: true,
    timeout: 800,
    circuitCheck: 2000, //interval
    timeoutThreshold: 5 //max errors in said interval before circuit is opened
};

//you will need an instance + topic per RPC that you want to implement
//of course your tasks can differ, and you can return errors, just like
//you use the old callbacks
const p = new Pohl(config);

//listen for some metric events (to send to influx for example)
p.on("metric", (type, value) => {
    switch(type){
        case "duration": console.log("took " + value + " ms"); break;
        case "send": console.log("send state increment for: " + value); break;
        default: console.log(type + ": " + value); break;
    }
});

//on one service you setup a receiver, that works on tasks and returns them back to the sender

const receiveTask = (err, task, callback) => {

    if(err){
        return console.log(err);
    }

    console.log("got task: " + JSON.stringify(task));
    task.okay = "made something";

    callback(null, task); //** when you call this.. *magic*
};

p.setupTaskReceiver(receiveTask, () => {
    console.log("instance ready to receive tasks.");
});

//on the other service you setup a sender, that sends tasks and gets a callback when the receiver sends a result

setTimeout(() => {

    let aTask = {
        make: "something",
        with: "this thing"
    };

    let startT = Date.now();

    p.sendTask(aTask,
        (err, taskResult) => { //** this will be called :D *magic*

            let endT = Date.now();

            if(err){
                return console.log(err);
            }

           console.log(taskResult);
            console.log("took: " + (endT - startT) + "ms.");
        }
    );

}, 100);

//again for the time (needs to warm up)
setTimeout(() => {

    let aTask = {
        make: "something",
        with: "this thing"
    };

    let startT = Date.now();

    p.sendTask(aTask,
        (err, taskResult) => { //** this will be called :D *magic*

            let endT = Date.now();

            if(err){
                return console.log(err);
            }

            console.log(taskResult);
            console.log("took: " + (endT - startT) + "ms.");
        }
    );

}, 150);

setTimeout(() => {
     process.exit(0);
}, 300);