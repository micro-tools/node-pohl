const Pohl = require("./../index.js");

const config = {
    topic: "pohl",
    autoReconnectInterval: 1500,
    logger: msg => console.log("info: " + JSON.stringify(msg)),
    debugger: msg => console.log("debug: " + JSON.stringify(msg)),
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
const p2 = new Pohl(config);
const p3 = new Pohl(config);

/*
//listen for some metric events (to send to influx for example)
p.on("metric", (type, value) => {
    switch(type){
        case "duration": console.log("took " + value + " ms"); break;
        case "send": console.log("send state increment for: " + value); break;
        default: console.log(type + ": " + value); break;
    }
}); */

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

p2.setupTaskReceiver(receiveTask, () => {
    console.log("instance ready to receive tasks.");
});

p3.setupTaskReceiver(receiveTask, () => {
    console.log("instance ready to receive tasks.");
});

//on the other service you setup a sender, that sends tasks and gets a callback when the receiver sends a result

let sendCount = 0;

setInterval(() => {

    let aTask = {
        make: "something",
        with: "this thing"
    };

    let startT = Date.now();
    sendCount++;

    p.sendTask(aTask,
        (err, taskResult) => { //** this will be called :D *magic*

            let endT = Date.now();

            if(err){
                return console.log(err);
            }

           console.log(taskResult);
            console.log("took: " + (endT - startT) + "ms. -> " + sendCount);
        }
    );

}, 3000);

setTimeout(() => {
     //process.exit(0);
}, 300);