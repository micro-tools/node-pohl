# node-pohl
- reliable distributed rpc messages via redis in simple callback-style
- ES6, coverage 60%+, lightweight, scalable & fast
- uses pub & sub, but makes sure that only a single instance actually works on the task via setnx.
- kind of rpc library that feels like making simple callbacks except for the fact that you can make them between services and not classes

#use case
- image you have enterprise microservices that have to make rpc/rest/soap calls to dispatch other information during incoming requests
- now think of the potential overhead that protocols like http can cause, you might most likely have to wait for 20-150ms overhead might depend on your infrastructure
- there has to be a way to have a standing connection, that sends messages reliably, distributed, scalable and fast with a fixed overhead that can be calculated
- all you need is a redis cluster/sentinel setup (works with single instance as well..), include this lib in your services and call 2 functions thats about it
- message queuing, task locking, failovers or timeouts have been wrapped in a super simple callback-like syntax that also scales inside of your software to multiple topics and endless message/task types
- overhead is between 3-5ms constantly
- benchmarks hits 9000 rpc/s (full-roundtrip) on mobile i7 @ 2GHZ and Redis 3.2.1 single docker instance, with a single sender

#how to use/install
- `npm install pohl`
- check ./example/index.js for a usage example
- run example with `npm start`
- run tests with `npm test` (requires localhost redis with default conf)
- run benchmark with `npm run benchmark`

#other
- License: MIT
- Author: Christian Fröhlingsdorf <chris@5cf.de>