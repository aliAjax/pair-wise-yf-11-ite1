const http = require("http");
const store = require("./store");
const service = require("./service");

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
  "GET /handovers?batchId="
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

  const rubbingDamagesMatch = pathname.match(/^\/rubbings\/([^/]+)\/damages$/);
  const damagePatchMatch = pathname.match(/^\/damages\/([^/]+)$/);
  const batchMatch = pathname.match(/^\/batches\/([^/]+)$/);
  const completeMatch = pathname.match(/^\/batches\/([^/]+)\/complete$/);
  const handoverMatch = pathname.match(/^\/batches\/([^/]+)\/handover$/);
  const handoversMatch = pathname.match(/^\/batches\/([^/]+)\/handovers$/);

  let status = 200;
  let payload;

  if (req.method === "GET" && pathname === "/health") {
    payload = { ok: true, service: "rubbing-repair-api", routes };
  } else if (req.method === "GET" && pathname === "/rubbings") {
    payload = { data: service.listRubbings(db) };
  } else if (req.method === "POST" && pathname === "/rubbings") {
    status = 201;
    payload = { data: service.createRubbing(db, await parseBody(req)) };
  } else if (rubbingDamagesMatch && req.method === "GET") {
    payload = { data: service.listRubbingDamages(db, rubbingDamagesMatch[1]) };
  } else if (rubbingDamagesMatch && req.method === "POST") {
    status = 201;
    payload = { data: service.createDamage(db, rubbingDamagesMatch[1], await parseBody(req)) };
  } else if (req.method === "GET" && pathname === "/damages") {
    payload = {
      data: service.queryDamages(db, { status: url.searchParams.get("status"), type: url.searchParams.get("type") })
    };
  } else if (damagePatchMatch && req.method === "PATCH") {
    payload = { data: service.patchDamage(db, damagePatchMatch[1], await parseBody(req)) };
  } else if (req.method === "GET" && pathname === "/workers") {
    payload = { data: service.listWorkers(db) };
  } else if (req.method === "POST" && pathname === "/workers") {
    status = 201;
    payload = { data: service.registerWorker(db, await parseBody(req)) };
  } else if (req.method === "GET" && pathname === "/batches") {
    payload = { data: service.listBatches(db) };
  } else if (req.method === "POST" && pathname === "/batches") {
    status = 201;
    payload = { data: service.createBatch(db, await parseBody(req)) };
  } else if (completeMatch && req.method === "POST") {
    payload = { data: service.completeBatch(db, completeMatch[1], await parseBody(req)) };
  } else if (handoverMatch && req.method === "POST") {
    payload = { data: service.handoverBatch(db, handoverMatch[1], await parseBody(req)) };
  } else if (handoversMatch && req.method === "GET") {
    payload = { data: service.listHandovers(db, handoversMatch[1]) };
  } else if (batchMatch && req.method === "GET") {
    payload = { data: service.getBatch(db, batchMatch[1]) };
  } else if (req.method === "GET" && pathname === "/handovers") {
    payload = { data: service.queryHandovers(db, { batchId: url.searchParams.get("batchId") }) };
  } else {
    status = 404;
    payload = { error: "接口不存在", routes };
  }

  // 写请求成功后才落库；校验被拒绝时不写，原批次、工时和进度不变
  if (req.method !== "GET" && status < 400) await store.writeDb(db);
  return send(res, status, payload);
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((error) => send(res, error.status || 500, { error: error.message || "服务器错误" }));
});

server.listen(PORT, () => {
  console.log(`Rubbing repair API running at http://127.0.0.1:${PORT}`);
});
