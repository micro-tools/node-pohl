const metrics = require("metrics");
const histogram = new metrics.Histogram.createUniformHistogram();
const spawn = require("child_process").spawn;

const worker1 = spawn('node' ,['perf/worker.js']);
const worker2 = spawn('node' ,['perf/worker.js']);
const worker3 = spawn('node' ,['perf/worker.js']);

worker1.stdout.pipe(process.stdout);
worker2.stdout.pipe(process.stdout);
worker3.stdout.pipe(process.stdout);

const cleanUp = () => {
    worker1.kill("SIGINT");
    worker2.kill("SIGINT");
    worker3.kill("SIGINT");
    process.exit(0);
};

const instance = require("./instance.js");
const i = instance("benchmark", false);

const aTask = {
    make: "something",
    with: "this thing"
};

const MAX_COUNT = 5000;
let totalDuration = 0;

const runTask = (count = 0, done = null) => {

    const startTime = Date.now();

    i.sendTask(aTask,
        (err, taskResult) => {

            const duration = Date.now() - startTime;
            totalDuration += duration;
            histogram.update(duration);

            if(err){
                return console.log(err);
            }

            if(done && count > MAX_COUNT){
                return done();
            }

            count++;
            runTask(count, done);
        }
    );
};

setTimeout(() => {
    const startTime = Date.now();
    runTask(0, () => {
        console.log("pohl metrics", JSON.stringify(histogram.printObj(), null, 2));
        const duration = Date.now() - startTime;
        console.log("total time taken: " + duration + " ms.");
        console.log("total duration: " + totalDuration + " ms.");
        let rpsps = MAX_COUNT / (totalDuration / 1000);
        console.log("rpcs per second: " + rpsps);
        cleanUp();
    });
}, 500);