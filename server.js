const http = require("http");
const store = require("./store");
const domain = require("./domain");

const PORT = Number(process.env.PORT || 3020);

const routes = [
  "GET /health",
  "GET /rubbings",
  "POST /rubbings",
  "GET /rubbings/:id/damages",
  "POST /rubbings/:id/damages",
  "GET /damages?status=&type=",
  "PATCH /damages/:id",
  "GET /workers",
  "POST /workers",
  "GET /batches",
  "POST /batches",
  "GET /batches/:id",
  "POST /batches/:id/complete",
  "POST /batches/:id/handover",
  "GET /batches/:id/handovers",
  "POST /batches/:id/restart"
];

function send(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body, null, 2));
}

async function parseBody(req) {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    const error = new Error("请求体必须是合法JSON");
    error.status = 400;
    throw error;
  }
}

async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;
  const db = await store.readDb();

  if (req.method === "GET" && pathname === "/health") {
    return send(res, 200, { ok: true, service: "rubbing-repair-api", routes });
  }

  if (req.method === "GET" && pathname === "/rubbings") {
    return send(res, 200, { data: domain.listRubbings(db) });
  }

  if (req.method === "POST" && pathname === "/rubbings") {
    const data = domain.createRubbing(db, await parseBody(req));
    await store.writeDb(db);
    return send(res, 201, { data });
  }

  const rubbingDamagesMatch = pathname.match(/^\/rubbings\/([^/]+)\/damages$/);
  if (rubbingDamagesMatch && req.method === "GET") {
    return send(res, 200, { data: domain.listDamages(db, rubbingDamagesMatch[1]) });
  }

  if (rubbingDamagesMatch && req.method === "POST") {
    const data = domain.createDamage(db, rubbingDamagesMatch[1], await parseBody(req));
    await store.writeDb(db);
    return send(res, 201, { data });
  }

  if (req.method === "GET" && pathname === "/damages") {
    const data = domain.queryDamages(db, {
      status: url.searchParams.get("status"),
      type: url.searchParams.get("type")
    });
    return send(res, 200, { data });
  }

  const damagePatchMatch = pathname.match(/^\/damages\/([^/]+)$/);
  if (damagePatchMatch && req.method === "PATCH") {
    const data = domain.patchDamage(db, damagePatchMatch[1], await parseBody(req));
    await store.writeDb(db);
    return send(res, 200, { data });
  }

  if (req.method === "GET" && pathname === "/workers") {
    return send(res, 200, { data: domain.listWorkers(db) });
  }

  if (req.method === "POST" && pathname === "/workers") {
    const data = domain.registerWorker(db, await parseBody(req));
    await store.writeDb(db);
    return send(res, 201, { data });
  }

  if (req.method === "GET" && pathname === "/batches") {
    return send(res, 200, { data: domain.listBatches(db) });
  }

  if (req.method === "POST" && pathname === "/batches") {
    const data = domain.createBatch(db, await parseBody(req));
    await store.writeDb(db);
    return send(res, 201, { data });
  }

  const handoverMatch = pathname.match(/^\/batches\/([^/]+)\/handover$/);
  if (handoverMatch && req.method === "POST") {
    const data = domain.handoverBatch(db, handoverMatch[1], await parseBody(req));
    await store.writeDb(db);
    return send(res, 201, { data });
  }

  const handoversMatch = pathname.match(/^\/batches\/([^/]+)\/handovers$/);
  if (handoversMatch && req.method === "GET") {
    return send(res, 200, { data: domain.listHandovers(db, handoversMatch[1]) });
  }

  const restartMatch = pathname.match(/^\/batches\/([^/]+)\/restart$/);
  if (restartMatch && req.method === "POST") {
    const data = domain.restartBatch(db, restartMatch[1], await parseBody(req));
    await store.writeDb(db);
    return send(res, 200, { data });
  }

  const completeMatch = pathname.match(/^\/batches\/([^/]+)\/complete$/);
  if (completeMatch && req.method === "POST") {
    const data = domain.completeBatch(db, completeMatch[1], await parseBody(req));
    await store.writeDb(db);
    return send(res, 200, { data });
  }

  const batchMatch = pathname.match(/^\/batches\/([^/]+)$/);
  if (batchMatch && req.method === "GET") {
    return send(res, 200, { data: domain.getBatch(db, batchMatch[1]) });
  }

  return send(res, 404, { error: "接口不存在", routes });
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((error) => send(res, error.status || 500, { error: error.message || "服务器错误" }));
});

server.listen(PORT, () => {
  console.log(`Rubbing repair API running at http://127.0.0.1:${PORT}`);
});
