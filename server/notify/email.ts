/**
 * 邮件推送（SMTP，基于 nodemailer）
 *
 * 说明：本应用是独立的 Node 进程，无法直接调用 Agent Mail 这类 MCP 工具，
 * 因此邮件通道走标准 SMTP。未配置 SMTP 时安全跳过（不影响站内通知）。
 */
import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import config from '../config.js';
import * as db from '../db.js';

let transporter: Transporter | null = null;

export interface SmtpOptions {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
}

/** 合并环境变量与运行时设置（运行时设置优先） */
export function resolveSmtpOptions(runtime?: Partial<SmtpOptions>): SmtpOptions {
  const saved = db.getSetting<Partial<SmtpOptions>>('smtp') || {};
  return {
    host: runtime?.host || saved.host || config.smtp.host,
    port: runtime?.port || saved.port || config.smtp.port,
    secure: runtime?.secure ?? saved.secure ?? config.smtp.secure,
    user: runtime?.user || saved.user || config.smtp.user,
    pass: runtime?.pass || saved.pass || config.smtp.pass,
    from:
      runtime?.from || saved.from || config.smtp.from || runtime?.user || saved.user || config.smtp.user,
  };
}

export function isEmailConfigured(runtime?: Partial<SmtpOptions>): boolean {
  const o = resolveSmtpOptions(runtime);
  return Boolean(o.host && o.from);
}

function getTransporter(runtime?: Partial<SmtpOptions>): Transporter {
  const o = resolveSmtpOptions(runtime);
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: o.host,
      port: o.port,
      secure: o.secure,
      auth: o.user ? { user: o.user, pass: o.pass } : undefined,
    });
  }
  return transporter;
}

/** 重置连接（设置变更后调用） */
export function resetEmailTransport(): void {
  transporter = null;
}

/** 发送一封 HTML 邮件 */
export async function sendEmail(options: {
  to: string;
  subject: string;
  html: string;
  runtime?: Partial<SmtpOptions>;
}): Promise<{ ok: boolean; detail?: string }> {
  const smtp = resolveSmtpOptions(options.runtime);
  if (!smtp.host || !smtp.from) {
    return { ok: false, detail: '未配置 SMTP' };
  }
  try {
    const t = getTransporter(options.runtime);
    await t.sendMail({ from: smtp.from, to: options.to, subject: options.subject, html: options.html });
    return { ok: true };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

/** 测试 SMTP 连接 */
export async function verifyEmail(runtime?: Partial<SmtpOptions>): Promise<{ ok: boolean; detail?: string }> {
  try {
    await getTransporter(runtime).verify();
    return { ok: true };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}
