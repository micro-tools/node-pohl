const Pohl = require("./../index.js");

const CONFIG = {
    topic: "pohl",
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
    timeout: 50
};

let getConfigCopy = (topic) => {
    let conf = JSON.parse(JSON.stringify(CONFIG));
    conf.topic = topic;
    return conf;
};

let createInstance = (topic, runSetup = true) => {

    const p = new Pohl(getConfigCopy(topic));

    const receiveTask = (err, task, callback) => {

        if(err){
            return console.log(err);
        }

        callback(null, task);
    };

    if(runSetup){
        p.setupTaskReceiver(receiveTask);
    }

    return p;
};

module.exports = createInstance;
