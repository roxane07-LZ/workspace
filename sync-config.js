/* ============================================================
   ☁️ 云端同步配置 —— 只需改这一处
   步骤（详见 README.md 与《云端部署指南.md》）：
   1. 打开 https://supabase.com 注册并新建一个 Project
   2. 左侧 SQL Editor 粘贴 supabase.sql 的内容并执行（建表+权限）
   3. Project Settings → API 复制下面两个值填进来
   4. Authentication → Providers → Email 建议关闭 "Confirm email"（个人使用免验证）
   5. 保存本文件，重新打开工作台
============================================================ */
window.SYNC_CONFIG = {
  SUPABASE_URL:      'YOUR_SUPABASE_URL',          // 形如 https://xxxx.supabase.co
  SUPABASE_ANON_KEY: 'YOUR_SUPABASE_ANON_KEY',     // 一长串 JWT 字符串

  /* 代理地址（PROXY_URL）
     ------------------------------------------------------------------
     如果你按《云端部署指南》把 server.js 部署到了 Render / Vercel，
     那么【工作台网页和它自身的接口是同一个网址、同源】，
     手机端访问云端网址时，网易云音乐 / 哔哩哔哩 直接可用，
     这里【保持空白即可】，不用填。

     仅当你「把网页和代理分别部署到两个不同域名」时才需要填，
     例如：网页放 GitHub Pages，代理放云端。这种进阶玩法一般用户用不到。 */
  PROXY_URL: ''
};
