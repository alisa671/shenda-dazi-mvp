# 深大搭子 MVP 后端

这是一个零依赖 Node.js API，用本地 `data.json` 持久化，目的是先跑通产品闭环。微信登录目前是 mock，认证审核提供开发接口，图片只接收 `evidenceUrl`；正式上线时再替换为微信接口、对象存储和真实审核后台。

## 启动

```bash
cd outputs/mvp-server
npm start
```

默认地址：`http://localhost:8787`（服务监听 `0.0.0.0:8787`）

## 最短体验流程

先登录，复制返回的 `token`：

```bash
curl -s -X POST http://127.0.0.1:8787/api/auth/wechat -H 'content-type: application/json' -d '{"code":"demo-user-1","phone":"13800000001"}'
```

后续请求加上：`Authorization: Bearer <token>`。

```bash
# 更新资料
curl -s -X PATCH http://127.0.0.1:8787/api/me -H "authorization: Bearer <token>" -H 'content-type: application/json' -d '{"nickname":"小林","faculty":"计算机科学与技术","grade":"大二","campus":"粤海","preferences":["运动","学习"]}'

# 提交认证
curl -s -X POST http://127.0.0.1:8787/api/verifications -H "authorization: Bearer <token>" -H 'content-type: application/json' -d '{"method":"学信网","evidenceUrl":"https://demo.invalid/evidence.jpg"}'

# 开发审核：把 verificationId 替换成上一步返回的 id
curl -s -X POST http://127.0.0.1:8787/api/dev/approve-verification -H "authorization: Bearer <token>" -H 'content-type: application/json' -d '{"verificationId":"替换为 verification id"}'

# 推荐列表 / 全部列表
curl -s 'http://127.0.0.1:8787/api/activities?mode=recommend' -H "authorization: Bearer <token>"
curl -s 'http://127.0.0.1:8787/api/activities?mode=all' -H "authorization: Bearer <token>"
```

## 接口范围

- `POST /api/auth/wechat`：微信登录 mock，返回 Bearer token。
- `GET/PATCH /api/me`：读取和更新资料。
- `POST /api/verifications`：提交深大邮箱、学信网、学生证或统一认证记录。
- `POST /api/dev/approve-verification`：开发环境审核认证。
- `GET /api/activities`：`mode=recommend|all`，支持 `category`、`campus`。
- `POST /api/activities`：发布邀约，要求已认证。
- `POST /api/activities/:id/applications`：申请加入，要求已认证。
- `GET /api/activities/:id/applications`：发起人查看申请。
- `PATCH /api/applications/:id`：`accept/reject/ignore`，接受后创建活动会话。
- `GET /api/sessions`：查看我的活动会话。
- `GET/POST /api/sessions/:id/messages`：读取和发送会话消息。

## 安全边界

这是开发版。生产环境必须把微信 code 换取、手机号解密、认证图片上传、审核权限、限流、敏感词检测和数据库迁移补齐；不要暴露 `/api/dev/approve-verification`。
