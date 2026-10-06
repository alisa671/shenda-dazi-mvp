const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { URL } = require('node:url');

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';
const DB_FILE = path.join(__dirname, 'data.json');
const now = () => new Date().toISOString();
const id = prefix => `${prefix}_${crypto.randomUUID()}`;

function seed() {
  return { users: [], sessions: [], verifications: [], applications: [], conversations: [], messages: [], activities: [
    { id: id('act'), ownerId: 'seed-owner', category: '运动', title: '羽毛球', startsAt: new Date(Date.now() + 86400000).toISOString(), campus: '粤海', place: '南区体育馆 3 号场', maxPeople: 4, joinedPeople: 2, cost: 'AA 场地费约 10 元/人', note: '新手友好，能对拍即可', status: 'published', createdAt: now() },
    { id: id('act'), ownerId: 'seed-owner', category: '学习', title: '考研数学自习', startsAt: new Date(Date.now() + 43200000).toISOString(), campus: '丽湖', place: '图书馆研讨室', maxPeople: 4, joinedPeople: 1, cost: '免费', note: '安静专注，完成一套真题', status: 'published', createdAt: now() }
  ] };
}

let db;
try { db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch { db = seed(); save(); }
function save() { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); }
function reply(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type, authorization', 'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS' });
  res.end(JSON.stringify(payload));
}
function readBody(req) {
  return new Promise((resolve, reject) => { let raw = ''; req.on('data', chunk => { raw += chunk; }); req.on('end', () => { if (!raw) return resolve({}); try { resolve(JSON.parse(raw)); } catch { reject(new Error('请求体必须是 JSON')); } }); req.on('error', reject); });
}
function currentUser(req) {
  const value = req.headers.authorization || ''; const token = value.startsWith('Bearer ') ? value.slice(7) : '';
  const session = db.sessions.find(item => item.token === token); return session && db.users.find(item => item.id === session.userId);
}
function safeUser(user) { const { phone, ...safe } = user; return safe; }
function auth(req, res) { const user = currentUser(req); if (!user) { reply(res, 401, { error: 'UNAUTHORIZED', message: '请先微信授权登录' }); return null; } return user; }
function verified(user, res) { if (user.verificationStatus !== 'approved') { reply(res, 403, { error: 'VERIFICATION_REQUIRED', message: '完成校园认证后才能使用此功能' }); return false; } return true; }
function activityError(input) {
  const fields = ['category', 'title', 'startsAt', 'campus', 'place', 'maxPeople', 'cost']; const missing = fields.filter(key => input[key] === undefined || input[key] === '');
  if (missing.length) return `缺少字段：${missing.join('、')}`;
  const time = new Date(input.startsAt); if (Number.isNaN(time.getTime()) || time.getTime() < Date.now() + 1800000) return '活动时间必须在未来 30 分钟之后';
  if (!Number.isInteger(Number(input.maxPeople)) || Number(input.maxPeople) < 2 || Number(input.maxPeople) > 20) return '人数上限应为 2 到 20 人';
  if (String(input.note || '').length > 120) return '补充说明不能超过 120 字'; return null;
}
function listActivities(user, url) {
  const category = url.searchParams.get('category'); const campus = url.searchParams.get('campus'); const mode = url.searchParams.get('mode') || 'recommend';
  const list = db.activities.filter(item => item.status === 'published' && new Date(item.startsAt) > new Date() && item.joinedPeople < item.maxPeople && (!category || item.category === category) && (!campus || campus === '全部' || item.campus === campus));
  const prefs = new Set(user.preferences || []);
  return list.map(item => ({ ...item, matchReason: mode === 'all' ? undefined : (prefs.has(item.category) ? '符合你的活动偏好' : '公开邀约') })).sort((a, b) => (b.matchReason === '符合你的活动偏好') - (a.matchReason === '符合你的活动偏好') || new Date(a.startsAt) - new Date(b.startsAt));
}

async function route(req, res) {
  if (req.method === 'OPTIONS') return reply(res, 204, {});
  const url = new URL(req.url, `http://${req.headers.host || HOST}`); const parts = url.pathname.split('/').filter(Boolean);
  try {
    if (req.method === 'GET' && url.pathname === '/') return reply(res, 200, { ok: true, service: 'shenda-dazi-mvp', message: 'API 服务已启动', health: '/api/health', docs: '请参阅 README.md' });
    if (req.method === 'GET' && url.pathname === '/api/health') return reply(res, 200, { ok: true, service: 'shenda-dazi-mvp', time: now() });
    if (req.method === 'POST' && url.pathname === '/api/auth/wechat') {
      const input = await readBody(req); if (!input.code && !input.phone) return reply(res, 400, { error: 'INVALID_REQUEST', message: '开发环境请传 code 或 phone' });
      const phone = String(input.phone || `mock-${input.code}`); let user = db.users.find(item => item.phone === phone);
      if (!user) { user = { id: id('usr'), phone, nickname: '', verificationStatus: 'unverified', preferences: [], createdAt: now() }; db.users.push(user); }
      const token = crypto.randomBytes(24).toString('hex'); db.sessions.push({ token, userId: user.id, createdAt: now() }); save(); return reply(res, 200, { token, user: safeUser(user) });
    }
    const user = auth(req, res); if (!user) return;
    if (req.method === 'GET' && url.pathname === '/api/me') return reply(res, 200, { user: safeUser(user) });
    if (req.method === 'PATCH' && url.pathname === '/api/me') { const input = await readBody(req); for (const key of ['nickname', 'gender', 'grade', 'faculty', 'campus', 'preferences', 'styles', 'mbti']) if (input[key] !== undefined) user[key] = input[key]; save(); return reply(res, 200, { user: safeUser(user) }); }
    if (req.method === 'POST' && url.pathname === '/api/verifications') { const input = await readBody(req); if (!['深大邮箱', '学信网', '学生证照片', '校园统一认证'].includes(input.method)) return reply(res, 400, { error: 'INVALID_METHOD', message: '不支持的认证方式' }); const record = { id: id('ver'), userId: user.id, method: input.method, evidenceUrl: input.evidenceUrl || '', status: 'pending', createdAt: now() }; db.verifications.push(record); user.verificationStatus = 'pending'; save(); return reply(res, 202, { verification: record, message: '认证材料已提交，等待审核' }); }
    if (req.method === 'POST' && url.pathname === '/api/dev/approve-verification') { const input = await readBody(req); const record = db.verifications.find(item => item.id === input.verificationId && item.userId === user.id); if (!record) return reply(res, 404, { error: 'NOT_FOUND', message: '认证记录不存在' }); record.status = 'approved'; user.verificationStatus = 'approved'; save(); return reply(res, 200, { user: safeUser(user), verification: record }); }
    if (req.method === 'GET' && url.pathname === '/api/activities') return reply(res, 200, { activities: listActivities(user, url) });
    if (req.method === 'POST' && url.pathname === '/api/activities') { if (!verified(user, res)) return; const input = await readBody(req); const error = activityError(input); if (error) return reply(res, 400, { error: 'INVALID_ACTIVITY', message: error }); const activity = { id: id('act'), ownerId: user.id, category: input.category, title: input.title, startsAt: input.startsAt, campus: input.campus, place: input.place, maxPeople: Number(input.maxPeople), joinedPeople: 1, cost: input.cost, note: input.note || '', status: 'published', createdAt: now() }; db.activities.push(activity); save(); return reply(res, 201, { activity }); }
    if (req.method === 'POST' && parts[0] === 'api' && parts[1] === 'activities' && parts[3] === 'applications') { if (!verified(user, res)) return; const activity = db.activities.find(item => item.id === parts[2]); if (!activity) return reply(res, 404, { error: 'NOT_FOUND', message: '邀约不存在' }); if (activity.ownerId === user.id) return reply(res, 400, { error: 'INVALID_REQUEST', message: '不能申请自己的邀约' }); if (activity.joinedPeople >= activity.maxPeople) return reply(res, 409, { error: 'FULL', message: '邀约已满员' }); const input = await readBody(req); const existing = db.applications.find(item => item.activityId === activity.id && item.applicantId === user.id && item.status === 'pending'); if (existing) return reply(res, 409, { error: 'DUPLICATE', message: '你已申请过该邀约' }); const application = { id: id('app'), activityId: activity.id, applicantId: user.id, reasons: input.reasons || [], note: input.note || '', status: 'pending', createdAt: now(), expiresAt: new Date(Date.now() + 43200000).toISOString() }; db.applications.push(application); save(); return reply(res, 201, { application }); }
    if (req.method === 'GET' && parts[0] === 'api' && parts[1] === 'activities' && parts[3] === 'applications') { const activity = db.activities.find(item => item.id === parts[2]); if (!activity || activity.ownerId !== user.id) return reply(res, 403, { error: 'FORBIDDEN', message: '无权查看申请' }); return reply(res, 200, { applications: db.applications.filter(item => item.activityId === activity.id) }); }
    if (req.method === 'PATCH' && parts[0] === 'api' && parts[1] === 'applications') { const application = db.applications.find(item => item.id === parts[2]); if (!application) return reply(res, 404, { error: 'NOT_FOUND', message: '申请不存在' }); const activity = db.activities.find(item => item.id === application.activityId); if (!activity || activity.ownerId !== user.id) return reply(res, 403, { error: 'FORBIDDEN', message: '只有发起人可以处理申请' }); const input = await readBody(req); if (!['accept', 'reject', 'ignore'].includes(input.action)) return reply(res, 400, { error: 'INVALID_ACTION', message: 'action 应为 accept、reject 或 ignore' }); application.status = input.action === 'accept' ? 'accepted' : input.action === 'reject' ? 'rejected' : 'ignored'; application.updatedAt = now(); let conversation = null; if (input.action === 'accept') { activity.joinedPeople += 1; conversation = { id: id('conv'), activityId: activity.id, memberIds: [activity.ownerId, application.applicantId], status: 'active', createdAt: now() }; db.conversations.push(conversation); application.conversationId = conversation.id; } save(); return reply(res, 200, { application, activity, conversation }); }
    if (req.method === 'GET' && url.pathname === '/api/sessions') return reply(res, 200, { sessions: db.conversations.filter(item => item.memberIds.includes(user.id)) });
    if (req.method === 'GET' && parts[0] === 'api' && parts[1] === 'sessions' && parts[3] === 'messages') return reply(res, 200, { messages: db.messages.filter(item => item.conversationId === parts[2]) });
    if (req.method === 'POST' && parts[0] === 'api' && parts[1] === 'sessions' && parts[3] === 'messages') { const conversation = db.conversations.find(item => item.id === parts[2] && item.memberIds.includes(user.id)); if (!conversation) return reply(res, 404, { error: 'NOT_FOUND', message: '会话不存在' }); const input = await readBody(req); if (!String(input.text || '').trim()) return reply(res, 400, { error: 'INVALID_MESSAGE', message: '消息不能为空' }); const message = { id: id('msg'), conversationId: conversation.id, senderId: user.id, text: String(input.text).slice(0, 500), createdAt: now() }; db.messages.push(message); save(); return reply(res, 201, { message }); }
    return reply(res, 404, { error: 'NOT_FOUND', message: '接口不存在' });
  } catch (error) { console.error(error); return reply(res, 500, { error: 'INTERNAL_ERROR', message: error.message }); }
}
http.createServer(route).listen(PORT, HOST, () => console.log(`深大搭子 MVP API: http://${HOST}:${PORT}`));
