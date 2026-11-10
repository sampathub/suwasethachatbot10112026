import { GoogleGenAI } from "@google/genai";

// Initialize Gemini Client using the environment variable lazily
let aiInstance: GoogleGenAI | null = null;

function getGeminiClient(): GoogleGenAI {
  if (!aiInstance) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error("GEMINI_API_KEY environment variable is not defined on Netlify! Please set it in your Netlify site Dashboard environment variables.");
    }
    aiInstance = new GoogleGenAI({
      apiKey: key,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return aiInstance;
}

// System Instruction for the Gemini chatbot
const SEXUAL_HEALTH_SYSTEM_INSTRUCTION = `
You are 'Suwasetha AI Friend & Consultant' (සුවසැත AI මිතුරා සහ උපදේශක), a highly qualified, empathetic, compassionate, and progressive medical doctor and sexual health educator. You specialize in sexual health, reproductive rights, intimacy, relationships, contraception, and preventing unwanted pregnancies, specifically tailored for youth and young adults in Sri Lanka.

Your tone should be like a wise, understanding, non-judgmental friend paired with a professional, compassionate medical doctor.

CRITICAL RULES AND GUIDELINES:
1. Speak warmly, respectfully, and with deep empathy. Use Sinhala (Sinhala Unicode or Singlish) as requested by the user. If they write in Singlish, reply in clear, easy-to-read Sinhala Unicode or simple Singlish/English depending on their preference, but beautiful, friendly Sinhala is highly preferred for Sinhala queries. Ensure your Sinhala is conversational, respectful, and uses comfortable modern pronouns like 'oya' (ඔයා) instead of overly dry clinical terms or rude words.
2. Under no circumstances should you judge, shame, scold, or moralize the user. They are seeking help privately, often out of fear or anxiety. Your support must be 100% confidential, objective, scientific, and evidence-based.
3. Be direct, clear, and open. DO NOT avoid or refuse to answer questions about sex, masturbation, intercourse, anatomy, pleasure, STIs, or contraception. You are a medical expert, so there are no taboo topics. Give medically accurate, scientific details.
4. Educate thoroughly on contraception:
   - Modern reliable methods (Condoms, Daily Oral Pills, Implants, Depo Injections, IUDs).
   - Emergency Contraceptive Pills (such as Postinor-2 or Mithuri): Explain that these are ONLY for emergencies (taken within 72 hours of unprotected sex), must NOT be abused as regular birth control due to hormonal side effects and reduced efficacy with frequent use, and highlight correct usage.
   - Clarify myths about pregnancy: Explain scientific facts clearly (e.g. you cannot get pregnant from kissing, dry humping with clothes on, washing, etc. Explain the exact mechanism of semen meeting the ovum).
5. Address anxiety, fear, and misinformation gently. Debunk myths with precise biological facts.
6. ABSOLUTE PROHIBITION ON REFUSALS OR "I AM AN AI" DEFLECTION (කිසිසේත්ම 'මට බෑ' හෝ 'මම AI නිසා නිශ්චිත රෝග විනිශ්චයක් දෙන්න බෑ' කියා නොපැවසීම):
   - CRITICAL DIRECTIVE: NEVER ever say or imply "මම AI කෙනෙක් නිසා ඔයාගේ තත්ත්වය දැකලා නිශ්චිත රෝග විනිශ්චයක් දෙන්න බෑ" or "I am an AI and cannot diagnose / help" or "මට බෑ".
   - Saying "I am an AI so I cannot" shatters the user's trust, increases their anxiety, and makes them feel abandoned. You are built to be their caring, reliable, and expert health ally.
   - If a user describes physical symptoms, rashes, bumps, sores, discharge, skin irritation, or bodily changes WITHOUT uploading a photo, warmly and gently invite them:
     "හැකිනම් ඡායාරූපයක් (Photo එකක්) ලබාදෙන්න, මට පුළුවන් උපරිමයෙන් පරීක්ෂා කරලා නිවැරදි උපදෙසක් සහ පැහැදිලි කිරීමක් ලබාදෙන්නම්."
   - When a photo is provided, or when symptoms are described, examine them thoroughly and provide a deep scientific, objective, and reassuring explanation.
   - ONLY at the very end of your response, if the symptoms appear severe, spreading, purulent, high-risk, or serious (බරපතලයි වගේනම්), gently advise clinical medical care (e.g., "මේ තත්ත්වය තවදුරටත් පවතින්නේ නම් හෝ වේදනාව/ලක්ෂණ උත්සන්න වේ නම්, සුදුසු වෛද්‍ය ප්‍රතිකාර ලබාගැනීම වඩාත් ආරක්ෂිතයි."). Do NOT start your message with disclaimers or evasions.
7. Provide official helpline contacts when appropriate:
   - Family Planning Association (FPA) Sri Lanka Helpline: +94 11 258 4157 / +94 77 955 2979
   - National STD/AIDS Control Programme hotline: +94 11 266 7163
   - Government Health Hotline: 1390
8. IMAGE EVALUATION & HEALTH DIAGNOSIS GUIDELINES:
   - UNDERSTANDING THE USER'S MINDSET & VULNERABILITY (පරිශීලකයාගේ මානසිකත්වය සහ අවශ්‍යතාවය තේරුම් ගැනීම):
     * Users upload photos to Suwasetha because they feel immense embarrassment, shame, stigma, or fear of showing private or intimate conditions to anyone in person (doctor, family, friends). This platform is their private sanctuary.
     * When you carefully examine their photo and provide an in-depth, scientifically thorough, reassuring answer, it brings them immense mental peace, relief, and clarity ("හිතට ලොකු සහනයක් සහ සැනසීමක්").
     * If you say "I cannot" or "I am an AI so I cannot diagnose", their trust is completely shattered and they feel helpless. You must be their supportive, confident medical ally.
   - When any user uploads ANY sensitive, confidential, intimate, anatomical, skin, or medical photograph (including rashes, sores, spots, swelling, genital skin conditions, discharge, Urine Pregnancy Test (UPT) strips, contraceptive pills, or prescriptions):
     * CRITICAL: NEVER refuse, reject, or say "I cannot view this" or "don't upload sensitive images".
     * Analyze the image to the MAXIMUM possible extent with deep clinical objectivity, warmth, and compassion.
     * Reassure the user warmly and immediately that their consultation and photo upload are 100% confidential and safe ("ඔබ මෙහි ඇතුළත් කළ ඡායාරූපය සහ විස්තර 100%ක් රහසිගතයි. කිසිදු බාහිර පුද්ගලයෙකුට එය නැරඹිය නොහැකි අතර මෙහි ඇතුළත් කිරීමෙන් කිසිදු අවදානමක් සිදු නොවේ.").
     * Thoroughly inspect visual details: color, morphology, borders, surface changes, test lines, text on medicine boxes.
     * Give a structured scientific breakdown: what it looks like, possible common causes (e.g., irritation, folliculitis, yeast/candidiasis, friction, hormonal, normal anatomy), self-care and hygiene steps.
     * ONLY at the conclusion of the response, if the condition looks severe, ulcerated, or potentially serious, recommend visiting a doctor or clinic for clinical treatment.
9. OBSCENE AND VULGAR WORD HANDLING (අසභ්‍ය හා ලිංගික වචන නොසලකා හැරීම):
   - Some users, especially young people in Sri Lanka, may use informal, crude, vulgar, or obscene words (අසභ්‍ය/කුණුහරුප වචන) in Sinhala or Singlish to describe sexual acts, anatomy, or problems. This is often due to a lack of formal scientific vocabulary or embarrassment.
   - You MUST completely ignore and overlook any such vulgar, informal, or obscene language. DO NOT judge, scold, warn, or moralize about the words they used. Do not even point out that they used bad words.
   - Identify the actual underlying medical, contraceptive, or reproductive health concern within the user's question, and respond to it directly, warmly, kindly, compassionately, and scientifically in Sinhala.
`;

// Live Sri Lanka Time network synchronization cache
let lastKnownNetworkTime: { timestampMs: number; fetchedAt: number } | null = null;

async function syncSriLankaNetworkTime(): Promise<number> {
  const now = Date.now();
  // Return cached time if fetched within the last 5 minutes
  if (lastKnownNetworkTime && (now - lastKnownNetworkTime.fetchedAt < 5 * 60 * 1000)) {
    const elapsed = now - lastKnownNetworkTime.fetchedAt;
    return lastKnownNetworkTime.timestampMs + elapsed;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1200); // 1.2s fast timeout
    const res = await fetch("https://timeapi.io/api/time/current/zone?timeZone=Asia/Colombo", {
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      const data: any = await res.json();
      if (data && data.dateTime) {
        const parsedMs = new Date(data.dateTime).getTime();
        if (!isNaN(parsedMs)) {
          lastKnownNetworkTime = {
            timestampMs: parsedMs,
            fetchedAt: Date.now()
          };
          console.log(`[TimeSync] Sri Lanka time synchronized via timeapi.io: ${data.dateTime}`);
          return parsedMs;
        }
      }
    }
  } catch {
    // Non-blocking fallback
  }

  return Date.now();
}

// Helper to compute formatted real-time current date and time anchored in Sri Lanka Time
function formatCurrentDateInfo(clientTimestamp?: string, clientTimeZone?: string, liveNetworkMs?: number) {
  let dateObj = new Date();

  // 1. If live network time is available and valid, use it as primary anchor
  if (liveNetworkMs && !isNaN(liveNetworkMs)) {
    dateObj = new Date(liveNetworkMs);
  } else if (clientTimestamp) {
    // 2. Otherwise prioritize client device timestamp if valid
    const parsed = new Date(clientTimestamp);
    if (!isNaN(parsed.getTime())) {
      dateObj = parsed;
    }
  }

  const timeZone = clientTimeZone || "Asia/Colombo";

  // Calculate formatted dates in Asia/Colombo (Sri Lanka Time)
  const slOptionsDate: Intl.DateTimeFormatOptions = {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  };
  const slOptionsFull: Intl.DateTimeFormatOptions = {
    timeZone,
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  };
  const slOptionsTime: Intl.DateTimeFormatOptions = {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  };

  const slDateFormatted = new Intl.DateTimeFormat("en-CA", slOptionsDate).format(dateObj); // "YYYY-MM-DD"
  const [year, month, day] = slDateFormatted.split("-");
  const slDateEnglish = new Intl.DateTimeFormat("en-US", slOptionsFull).format(dateObj);
  const slTime = new Intl.DateTimeFormat("en-US", slOptionsTime).format(dateObj);

  // Timezone-accurate weekday calculation
  const englishWeekday = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long" }).format(dateObj);
  const weekdayMap: Record<string, string> = {
    Sunday: "ඉරිදා",
    Monday: "සඳුදා",
    Tuesday: "අඟහරුවාදා",
    Wednesday: "බදාදා",
    Thursday: "බ්‍රහස්පතින්දා",
    Friday: "සිකුරාදා",
    Saturday: "සෙනසුරාදා",
  };
  const sinhalaDayOfWeek = weekdayMap[englishWeekday] || "";

  const sinhalaMonths = [
    "ජනවාරි", "පෙබරවාරි", "මාර්තු", "අප්‍රේල්", "මැයි", "ජූනි",
    "ජූලි", "අගෝස්තු", "සැප්තැම්බර්", "ඔක්තෝබර්", "නොවැම්බර්", "දෙසැම්බර්"
  ];
  const monthNum = parseInt(month, 10);
  const dayNum = parseInt(day, 10);
  const sinhalaMonthName = sinhalaMonths[monthNum - 1] || month;

  // Format time in Sinhala (පෙ.ව. / ප.ව.)
  const isPM = slTime.toUpperCase().includes("PM");
  const timeDigits = slTime.replace(/\s*[APap][Mm]/, "").trim();
  const sinhalaTimeFormatted = `${isPM ? "ප.ව." : "පෙ.ව."} ${timeDigits}`;

  const sinhalaDateFormatted = `${year} ${sinhalaMonthName} ${dayNum} වෙනිදා (${day}/${month}/${year}${sinhalaDayOfWeek ? ` - ${sinhalaDayOfWeek}` : ""})`;
  const fullSinhalaDateTime = `${year} ${sinhalaMonthName} ${dayNum} වෙනිදා (${sinhalaDayOfWeek}), ශ්‍රී ලංකා වේලාවෙන් ${sinhalaTimeFormatted} (${slTime})`;

  return {
    year,
    month,
    day,
    dayNum,
    sinhalaMonthName,
    sinhalaDayOfWeek,
    englishWeekday,
    sinhalaDateFormatted,
    sinhalaTimeFormatted,
    fullSinhalaDateTime,
    slDateFormatted,
    slDateEnglish,
    slTime,
  };
}

// Detect if a user is inquiring about the current date, day, or time
function isAskingAboutDateTime(text: string): { asksDate: boolean; asksTime: boolean; isDateTimeQuery: boolean } {
  if (!text) return { asksDate: false, asksTime: false, isDateTimeQuery: false };
  const lower = text.toLowerCase().trim();

  // Strict date query patterns (only when user specifically asks what the date is)
  const datePatterns = [
    /^(?:අද\s*)?දිනය\s*(?:කීයද|මොකක්ද|කියන්න|දන්වන්න)/,
    /^(?:අද\s*)?දවස\s*(?:මොකක්ද|කියන්න|කීයද)/,
    /^අද\s*කීයද[\s?]*$/,
    /^අද\s*(?:මොන\s*)?අවුරුද්දද?[\s?]*$/,
    /^අද\s*(?:මොන\s*)?මාසෙද?[\s?]*$/,
    /^අද\s*මොන\s*දවසද?[\s?]*$/,
    /^today\s*date[\s?]*$/i,
    /^what\s*is\s*today['’]?s\s*date[\s?]*$/i,
    /^what\s*day\s*is\s*(?:it\s*)?today[\s?]*$/i,
    /^what\s*is\s*the\s*date[\s?]*$/i,
    /^date\s*(?:eka\s*)?(?:mokakda|kiyada|please)[\s?]*$/i,
    /^ada\s*date\s*eka[\s?]*$/i,
    /^ada\s*dinaya[\s?]*$/i,
    /^ada\s*dawasa\s*mokakda[\s?]*$/i,
    /^ada\s*kiyada[\s?]*$/i
  ];

  // Strict time query patterns (only when user specifically asks what the time is)
  const timePatterns = [
    /^(?:දැන්\s*)?වෙලාව\s*(?:කීයද|කියන්න|දන්වන්න)/,
    /^(?:දැන්\s*)?වේලාව\s*(?:කීයද|කියන්න|දන්වන්න)/,
    /^දැන්\s*වෙලාව[\s?]*$/,
    /^දැන්\s*වේලාව[\s?]*$/,
    /^what\s*time\s*is\s*it[\s?]*$/i,
    /^current\s*time[\s?]*$/i,
    /^time\s*(?:eka\s*)?kiyada[\s?]*$/i,
    /^welawa\s*kiyada[\s?]*$/i,
    /^dan\s*welawa[\s?]*$/i,
    /^dan\s*time\s*(?:eka)?[\s?]*$/i
  ];

  const asksDate = datePatterns.some((p) => p.test(lower));
  const asksTime = timePatterns.some((p) => p.test(lower));
  return { asksDate, asksTime, isDateTimeQuery: asksDate || asksTime };
}

// Post-process to ensure no hallucinated past years slip in, and no unwanted dates are recited
function sanitizeAndCorrectDates(aiText: string, userText: string, dateInfo: ReturnType<typeof formatCurrentDateInfo>): string {
  let cleaned = aiText;

  // 1. Correct any hallucinated legacy dates containing "2024" or "2025":
  cleaned = cleaned.replace(/(?:2024|2025)\s*(?:මැයි|නොවැම්බර්|ජනවාරි|පෙබරවාරි|මාර්තු|අප්‍රේල්|ජූනි|ජූලි|අගෝස්තු|සැප්තැම්බර්|ඔක්තෝබර්|දෙසැම්බර්)\s*\d+\s*(?:වෙනිදා)?/g, dateInfo.sinhalaDateFormatted);
  cleaned = cleaned.replace(/(?:මැයි|නොවැම්බර්|ජනවාරි|පෙබරවාරි|මාර්තු|අප්‍රේල්|ජූනි|ජූලි|අගෝස්තු|සැප්තැම්බර්|ඔක්තෝබර්|දෙසැම්බර්)\s*මස\s*\d+\s*වෙනිදා[^.\n!?,]*(?:2024|2025)/g, dateInfo.sinhalaDateFormatted);
  cleaned = cleaned.replace(/(?:Thursday|Friday|Saturday|Sunday|Monday|Tuesday|Wednesday),\s*(?:January|February|March|April|May|June|July|August|September|October|November|December)\s*\d+(?:st|nd|rd|th)?,\s*(?:2024|2025)/gi, `${dateInfo.englishWeekday}, ${dateInfo.slDateEnglish}`);
  cleaned = cleaned.replace(/(?:Thursday|Friday|Saturday|Sunday|Monday|Tuesday|Wednesday),\s*May\s*16(?:th)?,\s*2024/gi, `${dateInfo.englishWeekday}, ${dateInfo.slDateEnglish}`);
  cleaned = cleaned.replace(/May\s*16(?:th)?,?\s*2024/gi, dateInfo.slDateEnglish);

  const dtQuery = isAskingAboutDateTime(userText);

  // 2. If the user did NOT explicitly ask for the date or time, remove any unsolicited opening declarations
  if (!dtQuery.isDateTimeQuery) {
    // Strip unwanted date/time preamble if AI volunteered it unprompted
    cleaned = cleaned.replace(/^(?:ආයුබෝවන්!?\s*)?(?:අද\s*දිනය\s*[^.\n!?]+(?:වෙනවා|වේ)\.?\s*)?(?:දැන්\s*(?:ශ්‍රී\s*ලංකා\s*)?වේලාව\s*[^.\n!?]+(?:වෙනවා|වේ)\.?\s*)?/i, (match) => {
      if (match.includes("ආයුබෝවන්")) {
        return "ආයුබෝවන්! ";
      }
      return "";
    });
    cleaned = cleaned.replace(/^අද\s*දිනය\s*\d{4}[^.\n!?]*[.\n!?]\s*/i, "");
    cleaned = cleaned.replace(/^දැන්\s*(?:ශ්‍රී\s*ලංකා\s*)?වේලාව\s*[^.\n!?]*[.\n!?]\s*/i, "");
  } else {
    // Only if the user explicitly asked for the date or time:
    const hasCurrentYear = cleaned.includes(dateInfo.year);
    const hasTimeMention = cleaned.includes(dateInfo.slTime) || cleaned.includes(dateInfo.sinhalaTimeFormatted) || cleaned.includes("වේලාව") || cleaned.includes("වෙලාව");

    if (dtQuery.asksDate && dtQuery.asksTime) {
      if (!hasCurrentYear || !hasTimeMention) {
        cleaned = `ආයුබෝවන්! අද දිනය **${dateInfo.sinhalaDateFormatted}** වන අතර, දැන් ශ්‍රී ලංකා වේලාව **${dateInfo.sinhalaTimeFormatted} (${dateInfo.slTime})** වෙනවා.\n\n${cleaned}`;
      }
    } else if (dtQuery.asksDate && !hasCurrentYear) {
      cleaned = `ආයුබෝවන්! අද දිනය **${dateInfo.sinhalaDateFormatted}** වෙනවා.\n\n${cleaned}`;
    } else if (dtQuery.asksTime && !hasTimeMention) {
      cleaned = `ආයුබෝවන්! දැන් ශ්‍රී ලංකා වේලාව **${dateInfo.sinhalaTimeFormatted} (${dateInfo.slTime})** වෙනවා.\n\n${cleaned}`;
    }
  }

  // 3. Strip any robotic "I am an AI so I cannot diagnose / help" disclaimers
  cleaned = cleaned.replace(
    /(?:නමුත්|කෙසේ\s*වෙතත්|මතක\s*තබා\s*ගන්න|සැලකිය\s*යුතුයි\s*:?)?\s*මම\s*(?:AI|කෘත්‍රිම\s*බුද්ධියක්|යන්ත්‍රයක්|කෘත්‍රිම\s*බුද්ධි\s*පද්ධතියක්)\s*(?:කෙනෙක්|නියෝජිතයෙක්|මිතුරෙක්)?\s*(?:නිසා|බැවින්|හේතුවෙන්)[^.\n!?]*(?:නිශ්චිත\s*(?:වෛද්‍ය\s*)?රෝග\s*විනිශ්චයක්|වෛද්‍ය\s*තීන්දුවක්|ප්‍රතිකාරයක්)[^.\n!?]*(?:දෙන්න\s*බෑ|ලබාදිය\s*නොහැක|දීමට\s*නොහැකිය|දෙන්න\s*බැහැ)[^.\n!?]*[.\n!?]?/gi,
    ""
  );

  cleaned = cleaned.replace(
    /මම\s*AI\s*කෙනෙක්\s*නිසා\s*ඔයාගේ\s*තත්ත්වය\s*දැකලා\s*නිශ්චිත\s*රෝග\s*විනිශ්චයක්\s*දෙන්න\s*(?:බෑ|බැහැ)[^.\n!?]*[.\n!?]?/gi,
    ""
  );

  cleaned = cleaned.replace(
    /(?:However,?\s*)?(?:As an AI|Since I am an AI|I am an AI,?\s*(?:so)?)[^.\n!?,]*(?:cannot|can't)\s*(?:provide|give)\s*(?:a\s*)?(?:definitive\s*)?(?:medical\s*)?diagnosis[^.\n!?]*[.\n!?]?/gi,
    ""
  );

  cleaned = cleaned.replace(/\n{3,}/g, "\n\n").trim();

  return cleaned;
}

// Helper to get dynamic real-time current date and time anchored in Sri Lanka Time
function getDynamicSystemInstruction(clientTimestamp?: string, clientTimeZone?: string, liveNetworkMs?: number): string {
  const dateInfo = formatCurrentDateInfo(clientTimestamp, clientTimeZone, liveNetworkMs);

  return `CRITICAL MANDATORY CURRENT REAL-WORLD CLOCK & CALENDAR GROUNDING:
- Current Real-World Date (අද සැබෑ දිනය): ${dateInfo.sinhalaDateFormatted} [${dateInfo.slDateFormatted}] (Sri Lanka Date: ${dateInfo.slDateEnglish}).
- Current Year (වර්තමාන වර්ෂය): ${dateInfo.year}
- Current Month (වත්මන් මාසය): ${dateInfo.sinhalaMonthName} (${dateInfo.month})
- Current Day of the Month (වත්මන් දිනය): ${dateInfo.day}
- Current Day of the Week (වත්මන් සතියේ දිනය): ${dateInfo.sinhalaDayOfWeek} (${dateInfo.englishWeekday})
- Current Real-Time Clock in Sri Lanka (ශ්‍රී ලංකා වේලාව): ${dateInfo.sinhalaTimeFormatted} (${dateInfo.slTime})

STRICT MANDATORY RULES ON DATE, TIME, SYMPTOMS & IMAGES:
1. STRICT RULE - DO NOT ADD DATE OR TIME TO YOUR ANSWER UNLESS EXPLICITLY ASKED (පරිශීලකයා නොඇසුවේ නම් කිසිසේත්ම දිනය හෝ වේලාව පිළිතුරට එක් නොකරන්න):
   - Users chat about their ongoing real-time health concerns, and they want DIRECT, ACCURATE answers to their specific questions.
   - NEVER add phrases like "අද දිනය 2026...", "දැන් වේලාව...", or "Today is..." to your reply UNLESS the user SPECIFICALLY asks "අද දිනය කීයද?", "දැන් වෙලාව කීයද?", or "what is today's date/time?".
   - Keep the real-time calendar and clock strictly in your background mind. Use it solely to calculate elapsed hours (e.g., 72-hour emergency pill window), menstrual cycle dates, missed period delays, or pregnancy weeks accurately.
2. Only when the user directly and explicitly asks what date or time it is:
   State directly that today is ${dateInfo.sinhalaDateFormatted} and Sri Lanka time is ${dateInfo.sinhalaTimeFormatted} (${dateInfo.slTime}).
3. Medical timing & pregnancy calculations:
   - When calculating emergency contraceptive windows (e.g., Postinor-2, within 72 hours / 3 days after unprotected sex) or menstrual/ovulation timings, anchor calculations against the current background date (${dateInfo.day}/${dateInfo.month}/${dateInfo.year}) and time (${dateInfo.slTime}), but directly advise whether it is safe or within time without reciting the current date/clock unnecessarily.
4. USER TRUST, CONFIDENTIALITY & SCIENTIFIC GUIDANCE:
   - NEVER EVER say or imply "මම AI කෙනෙක් නිසා ඔයාගේ තත්ත්වය දැකලා නිශ්චිත රෝග විනිශ්චයක් දෙන්න බෑ" or that you cannot help because you are an AI. Doing so shatters their trust!
   - If a user describes physical symptoms, rashes, bumps, discharge, or intimate bodily changes without an image, warmly and kindly invite them:
     "හැකිනම් ඡායාරූපයක් (Photo එකක්) ලබාදෙන්න, මට පුළුවන් උපරිමයෙන් පරීක්ෂා කරලා නිවැරදි උපදෙසක් සහ පැහැදිලි කිරීමක් ලබාදෙන්නම්."
   - When any image or symptom is provided, analyze it thoroughly with high scientific accuracy, reassuring the user of 100% confidentiality. Users consult here because they cannot show these issues to others in person.
   - ONLY at the very end of your response, if the condition looks severe or serious, advise seeking clinical medical care.

${SEXUAL_HEALTH_SYSTEM_INSTRUCTION}
`;
}

// Helper function to call Gemini with fallback and retry logic
async function generateContentWithFallback(contents: any[], dynamicSystemInstruction?: string) {
  // Put ultra-stable, high-capacity models first to prevent 503 unavailable spikes
  const modelsToTry = ["gemini-2.5-flash", "gemini-flash-latest", "gemini-3.8-flash", "gemini-3.1-flash-lite"];
  let lastError: any = null;

  const systemInstruction = dynamicSystemInstruction || getDynamicSystemInstruction();

  const safetySettings: any[] = [
    {
      category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
      threshold: "BLOCK_NONE",
    },
    {
      category: "HARM_CATEGORY_HATE_SPEECH",
      threshold: "BLOCK_ONLY_HIGH",
    },
    {
      category: "HARM_CATEGORY_HARASSMENT",
      threshold: "BLOCK_ONLY_HIGH",
    },
    {
      category: "HARM_CATEGORY_DANGEROUS_CONTENT",
      threshold: "BLOCK_ONLY_HIGH",
    },
  ];

  for (const model of modelsToTry) {
    try {
      const response = await getGeminiClient().models.generateContent({
        model: model,
        contents: contents,
        config: {
          systemInstruction: systemInstruction,
          temperature: 0.8,
          topP: 0.95,
          safetySettings: safetySettings,
        },
      });
      return response;
    } catch (err: any) {
      const is503 = err?.status === 503 || err?.code === 503 || err?.message?.includes('503') || err?.message?.includes('high demand') || err?.message?.includes('spikes');
      console.warn(`[Gemini Netlify API] Model ${model} ${is503 ? 'temporarily experiencing high demand (503)' : 'encountered error'}:`, err.message || err);
      lastError = err;
      if (is503) {
        // Brief pause before trying next candidate model
        await new Promise((resolve) => setTimeout(resolve, 350));
      }
    }
  }

  // Final recovery retry with a brief delay using the rock-solid gemini-2.5-flash model
  console.log("[Gemini Netlify API] Primary models failed. Waiting 800ms for a recovery retry using gemini-2.5-flash...");
  await new Promise((resolve) => setTimeout(resolve, 800));
  try {
    const response = await getGeminiClient().models.generateContent({
      model: "gemini-2.5-flash",
      contents: contents,
      config: {
        systemInstruction: systemInstruction,
        temperature: 0.8,
        topP: 0.95,
        safetySettings: safetySettings,
      },
    });
    console.log("[Gemini Netlify API] Recovery retry success with gemini-2.5-flash!");
    return response;
  } catch (err: any) {
    console.error("[Gemini Netlify API] All retries and fallbacks exhausted.");
    throw lastError || err;
  }
}

export const handler = async (event: any, context: any) => {
  // Handle CORS Preflight OPTIONS request
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
      body: "",
    };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: {
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({ error: "Method Not Allowed" }),
    };
  }

  try {
    const { messages, newMessage, newImage, clientTimestamp, clientTimeZone } = JSON.parse(event.body || "{}");

    const textContent = typeof newMessage === "string" ? newMessage : "";
    if (!textContent.trim() && !newImage) {
      return {
        statusCode: 400,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
        body: JSON.stringify({ error: "Either newMessage or newImage must be provided." }),
      };
    }

    const incomingMessages = Array.isArray(messages) ? messages : [];

    // Synchronize live background network date and time for Sri Lanka
    let liveNetworkMs: number | undefined;
    try {
      liveNetworkMs = await syncSriLankaNetworkTime();
    } catch {
      // Non-blocking fallback
    }

    const dateInfo = formatCurrentDateInfo(clientTimestamp, clientTimeZone, liveNetworkMs);

    // Map existing history for Gemini GenAI contents format
    const contents = incomingMessages.map((msg: any) => {
      const parts: any[] = [{ text: msg.content || "[ඡායාරූපය / Image]" }];
      
      if (msg.imageUrl) {
        const match = msg.imageUrl.match(/^data:(image\/[a-zA-Z+.-]+);base64,(.+)$/);
        if (match) {
          parts.push({
            inlineData: {
              mimeType: match[1],
              data: match[2],
            }
          });
        }
      }

      return {
        role: msg.role === "user" ? "user" : "model",
        parts: parts,
      };
    });

    // Add current user prompt and optional image
    const newUserParts: any[] = [];
    if (textContent.trim()) {
      newUserParts.push({ text: textContent });
    } else {
      newUserParts.push({ text: "[ඡායාරූපය විශ්ලේෂණය කරන්න / Analyze this image]" });
    }

    if (newImage && typeof newImage === "string") {
      const match = newImage.match(/^data:(image\/[a-zA-Z+.-]+);base64,(.+)$/);
      if (match) {
        newUserParts.push({
          inlineData: {
            mimeType: match[1],
            data: match[2],
          }
        });
      }
    }

    contents.push({
      role: "user",
      parts: newUserParts,
    });

    // Call the robust generation helper with dynamic date-aware system instruction and fallback/retry logic
    const dynamicInstruction = getDynamicSystemInstruction(clientTimestamp, clientTimeZone, liveNetworkMs);
    const response = await generateContentWithFallback(contents, dynamicInstruction);

    let rawResponseText = response.text || "සමාවන්න, මට ඒ සඳහා පිළිතුරක් සැකසීමට නොහැකි වුණා. කරුණාකර නැවත විමසන්න. (Sorry, I was unable to generate a response. Please ask again.)";

    // Sanitize and ensure accurate date references in response
    const finalAiResponse = sanitizeAndCorrectDates(rawResponseText, textContent, dateInfo);

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({
        text: finalAiResponse,
        dateInfo: {
          year: dateInfo.year,
          month: dateInfo.month,
          day: dateInfo.day,
          sinhalaDate: dateInfo.sinhalaDateFormatted,
          sinhalaTime: dateInfo.sinhalaTimeFormatted,
          slTime: dateInfo.slTime,
          dayOfWeek: dateInfo.sinhalaDayOfWeek
        }
      }),
    };
  } catch (err: any) {
    console.error("Error in Netlify chat function:", err);
    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({
        error: "සන්නිවේදන දෝෂයක් සිදු විය. කරුණාකර නැවත උත්සාහ කරන්න. (An API communication error occurred. Please try again.)",
        details: err?.message,
      }),
    };
  }
};
