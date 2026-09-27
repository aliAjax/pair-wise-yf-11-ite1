const { makeId } = require("./store");

// ---------- 通用判定 ----------

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function required(body, fields) {
  const missing = fields.filter((field) => body[field] === undefined || body[field] === "");
  if (missing.length) throw httpError(400, `缺少字段：${missing.join(", ")}`);
}

function findRubbing(db, rubbingId) {
  const rubbing = db.rubbings.find((item) => item.id === rubbingId);
  if (!rubbing) throw httpError(404, "拓片不存在");
  return rubbing;
}

function findBatch(db, batchId) {
  const batch = db.batches.find((item) => item.id === batchId);
  if (!batch) throw httpError(404, "修补批次不存在");
  return batch;
}

function findWorker(db, workerId, label = "师傅") {
  const worker = db.workers.find((item) => item.id === workerId);
  if (!worker) throw httpError(404, `${label}不存在`);
  return worker;
}

function workerBrief(worker) {
  return worker ? { id: worker.id, name: worker.name } : null;
}

function enrichBatch(db, batch) {
  const damages = db.damages.filter((item) => batch.damageIds.includes(item.id));
  return {
    ...batch,
    damages,
    total: damages.length,
    repaired: damages.filter((item) => item.status === "repaired").length,
    pending: damages.filter((item) => item.status !== "repaired").length,
    handler: workerBrief(db.workers.find((worker) => worker.id === batch.handlerId)),
    completedByWorker: workerBrief(db.workers.find((worker) => worker.id === batch.completedBy))
  };
}

function enrichHandover(db, record) {
  return {
    ...record,
    fromWorker: workerBrief(db.workers.find((worker) => worker.id === record.fromWorkerId)),
    toWorker: workerBrief(db.workers.find((worker) => worker.id === record.toWorkerId))
  };
}

// ---------- 拓片 ----------

function listRubbings(db) {
  return db.rubbings.map((rubbing) => {
    const damages = db.damages.filter((item) => item.rubbingId === rubbing.id);
    return {
      ...rubbing,
      damageCount: damages.length,
      pendingDamages: damages.filter((item) => item.status !== "repaired").length
    };
  });
}

function createRubbing(db, body) {
  required(body, ["code", "source", "paperSize"]);
  const rubbing = {
    id: makeId("rubbing"),
    code: body.code,
    source: body.source,
    paperSize: body.paperSize,
    note: body.note || "",
    createdAt: new Date().toISOString()
  };
  db.rubbings.push(rubbing);
  return rubbing;
}

// ---------- 缺损项 ----------

function listRubbingDamages(db, rubbingId) {
  findRubbing(db, rubbingId);
  return db.damages.filter((item) => item.rubbingId === rubbingId);
}

function createDamage(db, rubbingId, body) {
  findRubbing(db, rubbingId);
  required(body, ["position", "type", "beforePhotoUrl"]);
  const damage = {
    id: makeId("damage"),
    rubbingId,
    position: body.position,
    type: body.type,
    beforePhotoUrl: body.beforePhotoUrl,
    afterPhotoUrl: "",
    status: "pending",
    repairNote: "",
    batchId: null,
    createdAt: new Date().toISOString(),
    repairedAt: null
  };
  db.damages.push(damage);
  return damage;
}

function queryDamages(db, { status, type }) {
  return db.damages.filter((item) => (!status || item.status === status) && (!type || item.type === type));
}

function patchDamage(db, damageId, body) {
  const damage = db.damages.find((item) => item.id === damageId);
  if (!damage) throw httpError(404, "缺损项不存在");
  Object.assign(damage, {
    position: body.position ?? damage.position,
    type: body.type ?? damage.type,
    beforePhotoUrl: body.beforePhotoUrl ?? damage.beforePhotoUrl,
    afterPhotoUrl: body.afterPhotoUrl ?? damage.afterPhotoUrl,
    status: body.status ?? damage.status,
    repairNote: body.repairNote ?? damage.repairNote
  });
  damage.repairedAt = damage.status === "repaired" ? new Date().toISOString() : damage.repairedAt;
  return damage;
}

// ---------- 师傅登记 ----------

function registerWorker(db, body) {
  required(body, ["name", "types", "remainingMinutes"]);
  if (!Array.isArray(body.types) || body.types.length === 0) throw httpError(400, "types必须是非空数组");
  const remainingMinutes = Number(body.remainingMinutes);
  if (!Number.isFinite(remainingMinutes) || remainingMinutes < 0) throw httpError(400, "remainingMinutes必须是非负数字");
  const worker = {
    id: makeId("worker"),
    name: body.name,
    types: body.types,
    remainingMinutes,
    createdAt: new Date().toISOString()
  };
  db.workers.push(worker);
  return worker;
}

function listWorkers(db) {
  return db.workers;
}

// ---------- 修补批次 ----------

function listBatches(db) {
  return db.batches.map((batch) => enrichBatch(db, batch));
}

function getBatch(db, batchId) {
  return enrichBatch(db, findBatch(db, batchId));
}

function createBatch(db, body) {
  required(body, ["name", "damageIds"]);
  if (!Array.isArray(body.damageIds) || body.damageIds.length === 0) throw httpError(400, "damageIds必须是非空数组");
  const invalid = body.damageIds.filter((id) => !db.damages.find((damage) => damage.id === id));
  if (invalid.length) throw httpError(400, `缺损项不存在：${invalid.join(", ")}`);
  const handlerId = body.handlerId ?? body.workerId ?? null;
  if (handlerId) findWorker(db, handlerId, "承办人");
  const batch = {
    id: makeId("batch"),
    name: body.name,
    status: "open",
    damageIds: body.damageIds,
    note: body.note || "",
    handlerId,
    completedBy: null,
    createdAt: new Date().toISOString(),
    completedAt: null
  };
  db.batches.push(batch);
  db.damages.forEach((damage) => {
    if (body.damageIds.includes(damage.id)) {
      damage.batchId = batch.id;
      damage.status = "in_repair";
    }
  });
  return enrichBatch(db, batch);
}

function completeBatch(db, batchId, body) {
  const batch = findBatch(db, batchId);
  // 复核：批次已有承办人时，只有当前承办人可以提交结项，原师傅不能再提交
  if (batch.handlerId) {
    if (!body.workerId) throw httpError(403, "批次已有承办人，结项需携带当前承办人workerId");
    if (body.workerId !== batch.handlerId) throw httpError(403, "原师傅不能再提交，需由当前承办人结项");
  }
  const results = Array.isArray(body.results) ? body.results : [];
  batch.status = "completed";
  batch.completedAt = new Date().toISOString();
  batch.completedBy = batch.handlerId ?? body.workerId ?? null;
  batch.note = body.note ?? batch.note;
  db.damages.forEach((damage) => {
    if (!batch.damageIds.includes(damage.id)) return;
    const result = results.find((item) => item.damageId === damage.id) || {};
    damage.status = "repaired";
    damage.afterPhotoUrl = result.afterPhotoUrl || body.defaultAfterPhotoUrl || damage.afterPhotoUrl;
    damage.repairNote = result.repairNote || body.defaultRepairNote || damage.repairNote;
    damage.repairedAt = new Date().toISOString();
  });
  return enrichBatch(db, batch);
}

// ---------- 批次换手 ----------

function handoverBatch(db, batchId, body) {
  const batch = findBatch(db, batchId);
  if (batch.status === "completed") throw httpError(409, "批次已结项，不能交接");
  required(body, ["fromWorkerId", "items"]);
  if (!Array.isArray(body.items) || body.items.length === 0) throw httpError(400, "items必须是非空数组");
  const fromWorker = findWorker(db, body.fromWorkerId, "交出的师傅");
  if (batch.handlerId && batch.handlerId !== fromWorker.id) throw httpError(409, "交出人不是批次当前承办人");

  // 逐项归一化：原因、时刻、接手人、所需时长（均可由顶层默认值兜底）
  const now = new Date().toISOString();
  const items = body.items.map((item, index) => {
    const label = `第${index + 1}项`;
    if (!item.damageId) throw httpError(400, `${label}缺少damageId`);
    const toWorkerId = item.toWorkerId ?? body.toWorkerId;
    if (!toWorkerId) throw httpError(400, `${label}缺少接手人toWorkerId`);
    const reason = item.reason ?? body.reason;
    if (!reason) throw httpError(400, `${label}缺少交接原因reason`);
    const time = item.time ?? body.time ?? now;
    if (Number.isNaN(Date.parse(time))) throw httpError(400, `${label}时刻格式不正确`);
    const minutes = Number(item.minutes ?? body.minutes ?? 0);
    if (!Number.isFinite(minutes) || minutes < 0) throw httpError(400, `${label}所需时长必须是非负数字`);
    return { damageId: item.damageId, toWorkerId, reason, time, minutes };
  });

  const receiverIds = [...new Set(items.map((item) => item.toWorkerId))];
  if (receiverIds.length !== 1) throw httpError(400, "一次交接只能有一位接手人");
  const toWorker = findWorker(db, receiverIds[0], "接手人");
  if (toWorker.id === fromWorker.id) throw httpError(400, "接手人不能与交出人相同");

  // 逐项校验：归属本批次、未完成、类型相符
  const targets = items.map((item) => {
    const damage = db.damages.find((entry) => entry.id === item.damageId);
    if (!damage) throw httpError(404, `缺损项不存在：${item.damageId}`);
    if (!batch.damageIds.includes(damage.id)) throw httpError(409, `缺损项${item.damageId}不属于本批次`);
    if (damage.status === "repaired") throw httpError(409, `缺损项${item.damageId}已完成，材料保留，不能交接`);
    if (!toWorker.types.includes(damage.type)) throw httpError(409, `类型不符：接手人不能处理「${damage.type}」`);
    return damage;
  });

  // 时长校验：接手人当日剩余时长需覆盖本次交接全部缺损
  const totalMinutes = items.reduce((sum, item) => sum + item.minutes, 0);
  if (toWorker.remainingMinutes < totalMinutes) {
    throw httpError(409, `时长不足：接手人当日剩余${toWorker.remainingMinutes}分钟，本次交接需${totalMinutes}分钟`);
  }

  // 全部校验通过才落变更；任一拒绝则原批次、工时和进度不变
  toWorker.remainingMinutes -= totalMinutes;
  targets.forEach((damage) => {
    damage.status = "pending";
  });
  batch.handlerId = toWorker.id;
  const record = {
    id: makeId("handover"),
    batchId: batch.id,
    fromWorkerId: fromWorker.id,
    toWorkerId: toWorker.id,
    items: items.map((item) => ({
      damageId: item.damageId,
      toWorkerId: item.toWorkerId,
      reason: item.reason,
      time: item.time,
      minutes: item.minutes
    })),
    createdAt: now
  };
  db.handovers.push(record);
  return { batch: enrichBatch(db, batch), handover: enrichHandover(db, record) };
}

function listHandovers(db, batchId) {
  findBatch(db, batchId);
  return db.handovers.filter((item) => item.batchId === batchId).map((item) => enrichHandover(db, item));
}

function queryHandovers(db, { batchId }) {
  return db.handovers.filter((item) => !batchId || item.batchId === batchId).map((item) => enrichHandover(db, item));
}

module.exports = {
  listRubbings,
  createRubbing,
  listRubbingDamages,
  createDamage,
  queryDamages,
  patchDamage,
  registerWorker,
  listWorkers,
  listBatches,
  getBatch,
  createBatch,
  completeBatch,
  handoverBatch,
  listHandovers,
  queryHandovers
};
