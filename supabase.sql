-- 极简业务工作台 · Supabase 建表脚本
-- 在 Supabase 后台左侧「SQL Editor」新建查询，粘贴本文件全部内容，点 Run 执行。

-- 1) 快照表：每个登录账号一行，data 为整个工作台的 JSON 快照
create table if not exists public.wb_snapshot (
  uid         uuid primary key references auth.users(id) on delete cascade,
  data        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

-- 2) 开启行级安全（RLS），只有本人能读写自己的那一行
alter table public.wb_snapshot enable row level security;

drop policy if exists "owner_rw" on public.wb_snapshot;
create policy "owner_rw" on public.wb_snapshot
  for all
  using ( auth.uid() = uid )
  with check ( auth.uid() = uid );

-- 3) 更新时间触发器（可选，保证 updated_at 自动刷新）
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists trg_wb_updated on public.wb_snapshot;
create trigger trg_wb_updated before update on public.wb_snapshot
  for each row execute function public.set_updated_at();
