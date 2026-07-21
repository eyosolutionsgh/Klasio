/**
 * Intelligent assistance (FEATURES.md §21). Every one of these SUGGESTS; a person decides —
 * nothing in this module writes a mark, a remark, a message or a ledger row.
 *
 * The model is configured by environment (see common/llm.ts): Anthropic or Gemini in the cloud,
 * or Ollama on the school's own box. With no provider the deterministic features (risk flags)
 * still work, the drafting features say plainly that AI is off, and nothing degrades silently.
 */
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import {
  AuthUser,
  CurrentUser,
  RequireAnyPermission,
  RequireEntitlement,
  RequirePermission,
} from '../common/auth';
import {
  LlmConfig,
  callLlm,
  isLlmConfigured,
  isVisionConfigured,
  llmConfigFromEnv,
  parseJsonResponse,
} from '../common/llm';
import { balanceOf } from '../common/ledger';
import { childRisk, feeRisk } from '../common/risk';

class RemarkDraftDto {
  @IsString() studentId: string;
  @IsString() termId: string;
  /** TEACHER or HEAD — whose voice the draft speaks in. */
  @IsOptional() @IsString() kind?: 'TEACHER' | 'HEAD';
}

class QuestionsDto {
  @IsString() bankId: string;
  @IsString() @MinLength(3) @MaxLength(200) topic: string;
  @IsInt() @Min(1) @Max(20) count: number;
}

class AskDto {
  @IsString() @MinLength(3) @MaxLength(300) question: string;
}

interface GeneratedQuestion {
  text: string;
  options: string[];
  correctIndex: number;
  explanation?: string;
}

@Injectable()
export class AiService {
  private config: LlmConfig;

  constructor(private db: PrismaService) {
    this.config = llmConfigFromEnv();
  }

  status() {
    return {
      configured: isLlmConfigured(this.config),
      vision: isVisionConfigured(this.config),
      provider: this.config.anthropicApiKey
        ? 'anthropic'
        : this.config.geminiApiKey
          ? 'gemini'
          : this.config.ollamaUrl
            ? 'ollama'
            : null,
    };
  }

  private assertConfigured() {
    if (!isLlmConfigured(this.config)) {
      throw new BadRequestException(
        'No AI provider is configured on this server. Set ANTHROPIC_API_KEY, GEMINI_API_KEY, or OLLAMA_URL and OLLAMA_MODEL.',
      );
    }
  }

  // ── Remark drafting ────────────────────────────────────────────────

  /** Draft a report remark from the child's own numbers. The teacher edits and saves — or not. */
  async draftRemark(auth: AuthUser, dto: RemarkDraftDto) {
    this.assertConfigured();
    const report = await this.db.termReport.findFirst({
      where: { studentId: dto.studentId, termId: dto.termId, schoolId: auth.schoolId },
    });
    if (!report) throw new NotFoundException('Generate the report first');
    const student = await this.db.student.findFirstOrThrow({
      where: { id: dto.studentId, schoolId: auth.schoolId },
      select: { firstName: true },
    });

    const lines = (report.lines as { subject: string; total: number; grade: string }[]) ?? [];
    const summary = lines.map((l) => `${l.subject}: ${l.total} (${l.grade})`).join('; ');
    const voice =
      dto.kind === 'HEAD'
        ? 'the head teacher, brief and encouraging, signing off the whole report'
        : "the class teacher, who knows the child's daily effort";

    const result = await callLlm({
      config: this.config,
      systemPrompt: [
        'You draft one short remark for a Ghanaian terminal report card.',
        `Write as ${voice}.`,
        'Rules: 1–2 sentences, at most 30 words. Plain, warm, specific to the numbers given.',
        'Never invent facts beyond the marks. Never mention AI. Use the first name only.',
        'Return ONLY the remark text — no quotes, no preamble.',
      ].join('\n'),
      userPrompt: [
        `Child: ${student.firstName}`,
        `Subjects: ${summary || 'no subject lines'}`,
        `Overall total: ${Number(report.overallTotal).toFixed(1)}`,
        report.classPosition && report.classSize
          ? `Position: ${report.classPosition} of ${report.classSize}`
          : '',
        `Attendance: ${report.attendancePresent}/${report.attendanceTotal} days`,
      ]
        .filter(Boolean)
        .join('\n'),
      maxTokens: 120,
    });
    if (!result) throw new BadRequestException('The AI provider did not answer — try again');
    return { draft: result.text.replace(/^"|"$/g, ''), provider: result.provider };
  }

  // ── Question generation ────────────────────────────────────────────

  /** Propose MCQs for a bank. Nothing is saved — staff review each one and add what they keep. */
  async generateQuestions(auth: AuthUser, dto: QuestionsDto) {
    this.assertConfigured();
    const bank = await this.db.questionBank.findFirst({
      where: { id: dto.bankId, schoolId: auth.schoolId },
      include: { subject: { select: { name: true } }, level: { select: { name: true } } },
    });
    if (!bank) throw new NotFoundException('Bank not found');

    const result = await callLlm({
      config: this.config,
      systemPrompt: [
        'You write multiple-choice questions for Ghanaian school examinations (GES/NaCCA curriculum).',
        'Return ONLY a JSON array. Each element: {"text": string, "options": [4 strings], "correctIndex": 0-3, "explanation": string}.',
        'Questions must be factual, unambiguous, age-appropriate for the level named, with exactly one correct option.',
        'No prose outside the JSON.',
      ].join('\n'),
      userPrompt: `Subject: ${bank.subject.name}. Level: ${bank.level.name}. Topic: ${dto.topic}. Write ${dto.count} questions.`,
      jsonMode: true,
      maxTokens: 3000,
    });
    if (!result) throw new BadRequestException('The AI provider did not answer — try again');
    const parsed = parseJsonResponse<GeneratedQuestion[]>(result.text);
    if (!Array.isArray(parsed)) {
      throw new BadRequestException('The model returned something unusable — try again');
    }
    const suggestions = parsed
      .filter(
        (q) =>
          typeof q.text === 'string' &&
          Array.isArray(q.options) &&
          q.options.length >= 2 &&
          Number.isInteger(q.correctIndex) &&
          q.correctIndex >= 0 &&
          q.correctIndex < q.options.length,
      )
      .slice(0, dto.count);
    await this.db.audit(auth.schoolId, auth.sub, 'ai.questions', 'QuestionBank', dto.bankId, {
      topic: dto.topic,
      suggested: suggestions.length,
    });
    return { suggestions, provider: result.provider };
  }

  // ── Script capture (marks from a photograph) ───────────────────────

  async scriptCapture(auth: AuthUser, file: { buffer: Buffer; mimetype: string } | undefined) {
    this.assertConfigured();
    if (!isVisionConfigured(this.config)) {
      throw new BadRequestException(
        'Reading photographs needs a cloud AI provider (Anthropic or Gemini).',
      );
    }
    if (!file?.buffer) throw new BadRequestException('Attach a photo of the marked list');
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      throw new BadRequestException('Photos must be JPEG, PNG or WebP');
    }

    const result = await callLlm({
      config: this.config,
      systemPrompt: [
        'You read a photographed mark list or marked scripts from a Ghanaian school.',
        'Extract every (student, score) pair you can read with confidence.',
        'Return ONLY a JSON array: [{"name": string, "admissionNo": string|null, "score": number}].',
        'Skip anything illegible rather than guessing. No prose outside the JSON.',
      ].join('\n'),
      userPrompt: 'Extract the names/admission numbers and scores from this photograph.',
      image: { mimeType: file.mimetype, base64: file.buffer.toString('base64') },
      jsonMode: true,
      maxTokens: 2000,
    });
    if (!result) throw new BadRequestException('The AI provider did not answer — try again');
    const rows =
      parseJsonResponse<{ name: string; admissionNo: string | null; score: number }[]>(
        result.text,
      ) ?? [];

    // Match against the roll, so the reviewing teacher sees who each line probably is. Fuzzy on
    // admission number first, then exact-ish name. Unmatched rows are still shown — the person
    // decides.
    const students = await this.db.student.findMany({
      where: { schoolId: auth.schoolId, status: 'ACTIVE' },
      select: { id: true, firstName: true, lastName: true, admissionNo: true },
    });
    const byAdmission = new Map(students.map((s) => [s.admissionNo.toLowerCase(), s]));
    const byName = new Map(students.map((s) => [`${s.firstName} ${s.lastName}`.toLowerCase(), s]));
    const suggestions = rows
      .filter((r) => typeof r.score === 'number' && Number.isFinite(r.score))
      .map((r) => {
        const match =
          (r.admissionNo && byAdmission.get(r.admissionNo.toLowerCase())) ||
          byName.get((r.name ?? '').trim().toLowerCase()) ||
          null;
        return {
          readName: r.name ?? null,
          readAdmissionNo: r.admissionNo ?? null,
          score: r.score,
          studentId: match?.id ?? null,
          matchedName: match ? `${match.firstName} ${match.lastName}` : null,
        };
      });
    await this.db.audit(auth.schoolId, auth.sub, 'ai.script-capture', 'School', auth.schoolId, {
      read: suggestions.length,
    });
    return { suggestions, provider: result.provider };
  }

  // ── Plain-English questions of your own data ───────────────────────

  /**
   * Answered through a fixed catalogue of safe queries, never raw SQL: the model (or, with no
   * model, a keyword match) only ever CHOOSES a template; the numbers come from the same Prisma
   * queries the dashboards use. Money templates check the caller's own permissions.
   */
  async ask(auth: AuthUser, dto: AskDto) {
    const canSeeMoney = auth.permissions?.includes('fees.view') ?? false;
    const templates = [
      { key: 'enrolment_by_class', label: 'How many students are in each class?' },
      { key: 'attendance_by_class', label: 'How is attendance looking by class this term?' },
      ...(canSeeMoney
        ? [
            { key: 'fees_by_class', label: 'Which classes are furthest behind on fees?' },
            {
              key: 'collection_summary',
              label: 'How much have we billed and collected this term?',
            },
          ]
        : []),
    ];

    let key: string | null = null;
    if (isLlmConfigured(this.config)) {
      const result = await callLlm({
        config: this.config,
        systemPrompt: [
          'You route a school administrator’s question to ONE of a fixed set of reports.',
          'Return ONLY JSON: {"key": string|null}. Use null when no report answers the question.',
          'Never answer the question yourself.',
        ].join('\n'),
        userPrompt:
          `Reports:\n${templates.map((t) => `- ${t.key}: ${t.label}`).join('\n')}\n\n` +
          `Question: "${dto.question}"`,
        jsonMode: true,
        maxTokens: 60,
      });
      key = result ? (parseJsonResponse<{ key: string | null }>(result.text)?.key ?? null) : null;
    }
    if (!key) {
      // Deterministic fallback — the feature answers, with or without a model.
      const q = dto.question.toLowerCase();
      if (/fee|owe|owing|behind|arrears|defaul/.test(q) && canSeeMoney) key = 'fees_by_class';
      else if (/collect|billed|income|revenue/.test(q) && canSeeMoney) key = 'collection_summary';
      else if (/attend|absen|present/.test(q)) key = 'attendance_by_class';
      else if (/how many|enrol|students|class size|roll/.test(q)) key = 'enrolment_by_class';
    }
    if (!key || !templates.some((t) => t.key === key)) {
      return {
        answer: `I can answer: ${templates.map((t) => `“${t.label}”`).join(', ')}. Anything else needs the full reports.`,
        rows: [],
      };
    }
    return this.runTemplate(auth, key);
  }

  private async runTemplate(auth: AuthUser, key: string) {
    const term = await this.db.term.findFirst({
      where: { isCurrent: true, academicYear: { schoolId: auth.schoolId, isCurrent: true } },
    });

    if (key === 'enrolment_by_class') {
      const classes = await this.db.classRoom.findMany({
        where: { schoolId: auth.schoolId },
        include: { _count: { select: { students: { where: { status: 'ACTIVE' } } } } },
        orderBy: { name: 'asc' },
      });
      const rows = classes.map((c) => ({ label: c.name, value: c._count.students }));
      const total = rows.reduce((s, r) => s + r.value, 0);
      return { answer: `${total} active students across ${rows.length} classes.`, rows };
    }

    if (key === 'attendance_by_class') {
      if (!term) return { answer: 'No term is running.', rows: [] };
      const records = await this.db.attendanceRecord.findMany({
        where: {
          schoolId: auth.schoolId,
          date: { gte: term.startDate, lte: term.endDate },
        },
        select: { status: true, student: { select: { classRoom: { select: { name: true } } } } },
      });
      const byClass = new Map<string, { present: number; total: number }>();
      for (const r of records) {
        const cls = r.student.classRoom?.name ?? '—';
        const agg = byClass.get(cls) ?? { present: 0, total: 0 };
        agg.total++;
        if (r.status === 'PRESENT' || r.status === 'LATE') agg.present++;
        byClass.set(cls, agg);
      }
      const rows = [...byClass]
        .map(([label, a]) => ({ label, value: Math.round((a.present / a.total) * 100) }))
        .sort((a, b) => a.value - b.value);
      return {
        answer:
          rows.length === 0
            ? 'No attendance marked this term yet.'
            : `Attendance rate by class this term, lowest first — ${rows[0].label} needs a look at ${rows[0].value}%.`,
        rows,
        unit: '%',
      };
    }

    if (key === 'fees_by_class') {
      const entries = await this.db.ledgerEntry.findMany({
        where: { schoolId: auth.schoolId },
        select: {
          id: true,
          type: true,
          amount: true,
          reversedId: true,
          student: { select: { id: true, classRoom: { select: { name: true } } } },
        },
      });
      const byStudent = new Map<string, { cls: string; entries: typeof entries }>();
      for (const e of entries) {
        const cur = byStudent.get(e.student.id) ?? {
          cls: e.student.classRoom?.name ?? '—',
          entries: [] as typeof entries,
        };
        cur.entries.push(e);
        byStudent.set(e.student.id, cur);
      }
      const byClass = new Map<string, number>();
      for (const { cls, entries: es } of byStudent.values()) {
        const bal = balanceOf(es);
        if (bal > 0) byClass.set(cls, (byClass.get(cls) ?? 0) + bal);
      }
      const rows = [...byClass]
        .map(([label, value]) => ({ label, value: Math.round(value * 100) / 100 }))
        .sort((a, b) => b.value - a.value);
      return {
        answer:
          rows.length === 0
            ? 'Nothing is outstanding — every account is settled.'
            : `${rows[0].label} is furthest behind, with GHS ${rows[0].value.toLocaleString('en-GH')} outstanding.`,
        rows,
        unit: 'GHS',
      };
    }

    // collection_summary
    if (!term) return { answer: 'No term is running.', rows: [] };
    const entries = await this.db.ledgerEntry.findMany({
      where: { schoolId: auth.schoolId, termId: term.id },
    });
    const billed = entries
      .filter((e) => e.type === 'INVOICE')
      .reduce((s, e) => s + Number(e.amount), 0);
    const collected = entries
      .filter((e) => e.type === 'PAYMENT')
      .reduce((s, e) => s + Number(e.amount), 0);
    const pct = billed > 0 ? Math.round((collected / billed) * 100) : 0;
    return {
      answer: `This term: GHS ${billed.toLocaleString('en-GH')} billed, GHS ${collected.toLocaleString('en-GH')} collected — ${pct}%.`,
      rows: [
        { label: 'Billed', value: Math.round(billed) },
        { label: 'Collected', value: Math.round(collected) },
      ],
      unit: 'GHS',
    };
  }

  // ── WhatsApp free-text understanding (FEATURES.md §21) ─────────────

  /**
   * Map a parent's own words onto the assistant's set list — and ONLY the set list. The model
   * chooses an intent or says out-of-scope; it never composes an answer, so it can never
   * invent one. Null when no model is configured or the message is off-list, and the bot's
   * deterministic refusal stands.
   */
  async classifyFreeText(text: string): Promise<string | null> {
    if (!isLlmConfigured(this.config)) return null;
    const INTENTS = [
      'BALANCE',
      'RESULTS',
      'ATTENDANCE',
      'REPORT_ABSENCE',
      'PICKUP_CHANGE',
      'NOTICES',
      'HUMAN',
    ];
    const result = await callLlm({
      config: this.config,
      systemPrompt: [
        "You classify a parent's WhatsApp message to a school assistant.",
        `The ONLY intents are: ${INTENTS.join(', ')}.`,
        'BALANCE = fees owed. RESULTS = terminal report. ATTENDANCE = attendance record.',
        'REPORT_ABSENCE = the child will be away/sick today. PICKUP_CHANGE = someone different collects today.',
        'NOTICES = notices, events, term dates. HUMAN = wants a person.',
        'Return ONLY JSON: {"intent": string|null}. Use null for greetings, small talk, or anything else.',
        'When unsure, use null — never guess.',
      ].join('\n'),
      userPrompt: `Message: "${text.slice(0, 300)}"`,
      jsonMode: true,
      maxTokens: 40,
    });
    if (!result) return null;
    const parsed = parseJsonResponse<{ intent: string | null }>(result.text);
    return parsed?.intent && INTENTS.includes(parsed.intent) ? parsed.intent : null;
  }

  // ── Risk flags (deterministic — work with no model at all) ─────────

  /** Families likely to fall behind, worst first, each with its reasons. */
  async defaultRisk(auth: AuthUser) {
    const term = await this.db.term.findFirst({
      where: { isCurrent: true, academicYear: { schoolId: auth.schoolId, isCurrent: true } },
    });
    const entries = await this.db.ledgerEntry.findMany({
      where: { schoolId: auth.schoolId },
      include: {
        student: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            admissionNo: true,
            status: true,
            classRoom: { select: { name: true } },
          },
        },
      },
    });
    const reminders = await this.db.smsMessage.groupBy({
      by: ['batchId'],
      where: { schoolId: auth.schoolId, batchId: { startsWith: 'FEEREM-' } },
      _count: true,
    });
    const reminderByStudent = new Map<string, number>();
    for (const r of reminders) {
      const studentId = r.batchId?.split('-').pop();
      if (studentId) {
        reminderByStudent.set(studentId, (reminderByStudent.get(studentId) ?? 0) + 1);
      }
    }

    const byStudent = new Map<string, typeof entries>();
    for (const e of entries) {
      byStudent.set(e.student.id, [...(byStudent.get(e.student.id) ?? []), e]);
    }
    const now = Date.now();
    const flags = [];
    for (const [studentId, es] of byStudent) {
      const student = es[0].student;
      if (student.status !== 'ACTIVE') continue;
      const balance = balanceOf(es);
      if (balance <= 0) continue;
      const billedThisTerm = es
        .filter((e) => e.type === 'INVOICE' && (!term || e.termId === term.id))
        .reduce((s, e) => s + Number(e.amount), 0);
      const lastPayment = es
        .filter((e) => e.type === 'PAYMENT')
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
      const risk = feeRisk({
        balance,
        billedThisTerm,
        daysSinceLastPayment: lastPayment
          ? Math.floor((now - lastPayment.createdAt.getTime()) / 86_400_000)
          : null,
        remindersThisTerm: reminderByStudent.get(studentId) ?? 0,
      });
      if (risk.level === 'LOW') continue;
      flags.push({
        studentId,
        name: `${student.firstName} ${student.lastName}`,
        admissionNo: student.admissionNo,
        className: student.classRoom?.name ?? null,
        balance: Math.round(balance * 100) / 100,
        ...risk,
      });
    }
    return flags.sort((a, b) => b.score - a.score).slice(0, 50);
  }

  /** Children whose attendance-and-results pattern says to look, each with its reasons. */
  async childrenAtRisk(auth: AuthUser) {
    const term = await this.db.term.findFirst({
      where: { isCurrent: true, academicYear: { schoolId: auth.schoolId, isCurrent: true } },
    });
    const students = await this.db.student.findMany({
      where: { schoolId: auth.schoolId, status: 'ACTIVE' },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        admissionNo: true,
        classRoom: { select: { name: true } },
      },
    });
    const [attendance, reports] = await Promise.all([
      term
        ? this.db.attendanceRecord.groupBy({
            by: ['studentId', 'status'],
            where: { schoolId: auth.schoolId, date: { gte: term.startDate, lte: term.endDate } },
            _count: true,
          })
        : Promise.resolve([]),
      this.db.termReport.findMany({
        where: { schoolId: auth.schoolId },
        orderBy: { generatedAt: 'asc' },
        select: { studentId: true, overallTotal: true },
      }),
    ]);

    const att = new Map<string, { present: number; total: number }>();
    for (const a of attendance) {
      const agg = att.get(a.studentId) ?? { present: 0, total: 0 };
      agg.total += a._count;
      if (a.status === 'PRESENT' || a.status === 'LATE') agg.present += a._count;
      att.set(a.studentId, agg);
    }
    const totalsByStudent = new Map<string, number[]>();
    for (const r of reports) {
      totalsByStudent.set(r.studentId, [
        ...(totalsByStudent.get(r.studentId) ?? []),
        Number(r.overallTotal),
      ]);
    }

    const flags = [];
    for (const s of students) {
      const a = att.get(s.id);
      const totals = totalsByStudent.get(s.id) ?? [];
      const risk = childRisk({
        attendanceRate: a && a.total > 0 ? (a.present / a.total) * 100 : null,
        markedDays: a?.total ?? 0,
        lastTwoTotals: totals.slice(-2),
      });
      if (!risk.flagged) continue;
      flags.push({
        studentId: s.id,
        name: `${s.firstName} ${s.lastName}`,
        admissionNo: s.admissionNo,
        className: s.classRoom?.name ?? null,
        reasons: risk.reasons,
      });
    }
    return flags;
  }
}

@Controller('ai')
export class AiController {
  constructor(private svc: AiService) {}

  @Get('status')
  status() {
    return this.svc.status();
  }

  @Post('remarks/draft')
  @RequireEntitlement('ai.remarks')
  @RequireAnyPermission('reports.remark.teacher', 'reports.remark.head', 'reports.generate')
  draftRemark(@CurrentUser() user: AuthUser, @Body() dto: RemarkDraftDto) {
    return this.svc.draftRemark(user, dto);
  }

  @Post('questions')
  @RequireEntitlement('exams.cbt')
  @RequirePermission('assessment.configure')
  questions(@CurrentUser() user: AuthUser, @Body() dto: QuestionsDto) {
    return this.svc.generateQuestions(user, dto);
  }

  @Post('script-capture')
  @RequireEntitlement('ai.script-capture')
  @RequirePermission('marks.enter')
  @UseInterceptors(FileInterceptor('file'))
  scriptCapture(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: { buffer: Buffer; mimetype: string },
  ) {
    return this.svc.scriptCapture(user, file);
  }

  @Post('ask')
  @RequireEntitlement('ai.insights')
  ask(@CurrentUser() user: AuthUser, @Body() dto: AskDto) {
    return this.svc.ask(user, dto);
  }

  @Get('default-risk')
  @RequireEntitlement('ai.default-risk')
  @RequirePermission('fees.view')
  defaultRisk(@CurrentUser() user: AuthUser) {
    return this.svc.defaultRisk(user);
  }

  @Get('at-risk')
  @RequireEntitlement('ai.insights')
  @RequireAnyPermission('attendance.dashboards', 'reports.view')
  atRisk(@CurrentUser() user: AuthUser, @Query('limit') _limit?: string) {
    return this.svc.childrenAtRisk(user);
  }
}

@Module({
  controllers: [AiController],
  providers: [AiService],
  exports: [AiService],
})
export class AiModule {}
