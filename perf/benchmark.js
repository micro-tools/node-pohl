const metrics = require("metrics");
const histogram = new metrics.Histogram.createUniformHistogram();
const spawn = require("child_process").spawn;
const async = require("async");

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

let totalDuration = 0;

const runTask = (taskId = 0, done = null) => {

    i.sendTask(aTask,
        (err, taskResult) => {

            if(err){
                return console.log(err);
            }

            if(done){
                done(null, taskId);
            }
        }
    );
};

const startBenchmark = (count = 1000, round= 0, maxRound = 1, done = null) => {

    var tasks = [];
    for(var i = 0; i < count; i++){
        tasks.push(i);
    }

    const startTime = Date.now();

    async.map(tasks, runTask, (err, results) => {

        const duration = Date.now() - startTime;
        totalDuration += duration;
        histogram.update(duration);

        if(err) {
            console.log(err);
            return done();
        }

        if(results.length !== tasks.length){
            console.log("executed task lengths differ: " + results.length + " - " + tasks.length);
            return done();
        }

        if(round >= maxRound){
            return done();
        } else {
            round++;
            startBenchmark(count, round, maxRound, done);
        }
    });
};

setTimeout(() => {
    const startTime = Date.now();
    var count = 40;
    var rounds = 800;
    var total = count * rounds;
    startBenchmark(count, 0, rounds, () => {
        console.log("pohl metrics", JSON.stringify(histogram.printObj(), null, 2));
        const duration = Date.now() - startTime;
        console.log("total time taken: " + duration + " ms.");
        console.log("total duration: " + totalDuration + " ms.");
        let rpsps = total / (totalDuration / 1000);
        console.log("rpcs per second: " + rpsps);
        cleanUp();
    });
}, 500);