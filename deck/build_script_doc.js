// Builds the demo video script as a Word document.
//   node deck/build_script_doc.js
const fs = require('fs');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  BorderStyle, Table, TableRow, TableCell, WidthType, ShadingType, LevelFormat,
} = require('docx');

const ORANGE = 'E1663B';
const INK = '1F1F1F';
const MUTED = '5E5E5E';
const RULE = 'DDDDDD';

const P = (text, o = {}) => new Paragraph({
  spacing: { before: o.before ?? 0, after: o.after ?? 120, line: o.line ?? 276 },
  indent: o.indent,
  alignment: o.align,
  border: o.border,
  children: [new TextRun({
    text, bold: o.bold, italics: o.italics, size: o.size ?? 21,
    color: o.color ?? INK, font: o.font ?? 'Calibri',
  })],
});

/** Paragraph built from [text, {bold,italics,color}] pairs. */
const Rich = (parts, o = {}) => new Paragraph({
  spacing: { before: o.before ?? 0, after: o.after ?? 120, line: 276 },
  indent: o.indent,
  children: parts.map(([text, f = {}]) => new TextRun({
    text, bold: f.bold, italics: f.italics, size: f.size ?? 21,
    color: f.color ?? INK, font: 'Calibri',
  })),
});

const H1 = (text) => new Paragraph({
  heading: HeadingLevel.HEADING_1,
  spacing: { before: 320, after: 160 },
  children: [new TextRun({ text, bold: true, size: 30, color: INK, font: 'Calibri' })],
});

const H2 = (text) => new Paragraph({
  heading: HeadingLevel.HEADING_2,
  spacing: { before: 260, after: 120 },
  children: [new TextRun({ text, bold: true, size: 24, color: ORANGE, font: 'Calibri' })],
});

const Bullet = (text, level = 0) => new Paragraph({
  numbering: { reference: 'bullets', level },
  spacing: { after: 90, line: 276 },
  children: [new TextRun({ text, size: 21, color: INK, font: 'Calibri' })],
});

const Rule = () => new Paragraph({
  spacing: { before: 160, after: 160 },
  border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: RULE } },
  children: [new TextRun({ text: '', size: 2 })],
});

/** A shaded "what to show on screen" block. */
const ShowBox = (lines) => new Table({
  width: { size: 9360, type: WidthType.DXA },
  columnWidths: [9360],
  rows: [new TableRow({
    children: [new TableCell({
      width: { size: 9360, type: WidthType.DXA },
      shading: { type: ShadingType.CLEAR, fill: 'FBF1EC' },
      margins: { top: 120, bottom: 120, left: 180, right: 180 },
      children: lines.map((l, i) => Rich(
        [['ON SCREEN  ', { bold: true, color: ORANGE, size: 17 }], [l, { color: INK }]].slice(i === 0 ? 0 : 1),
        { after: i === lines.length - 1 ? 0 : 80 },
      )),
    })],
  })],
});

/** A quoted line of narration. */
const Say = (text) => new Paragraph({
  spacing: { after: 130, line: 288 },
  indent: { left: 340 },
  border: { left: { style: BorderStyle.SINGLE, size: 12, color: ORANGE, space: 12 } },
  children: [new TextRun({ text, size: 22, color: INK, font: 'Calibri' })],
});

const Timing = (range, title) => new Paragraph({
  spacing: { before: 300, after: 110 },
  children: [
    new TextRun({ text: range + '   ', bold: true, size: 22, color: ORANGE, font: 'Consolas' }),
    new TextRun({ text: title, bold: true, size: 23, color: INK, font: 'Calibri' }),
  ],
});

const doc = new Document({
  creator: 'Navixa',
  title: 'Navixa — Demo Video Script',
  numbering: {
    config: [{
      reference: 'bullets',
      levels: [
        { level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 380, hanging: 200 } } } },
        { level: 1, format: LevelFormat.BULLET, text: '◦', alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 740, hanging: 200 } } } },
      ],
    }],
  },
  sections: [{
    properties: { page: { margin: { top: 1080, bottom: 1080, left: 1080, right: 1080 } } },
    children: [
      // ---------------------------------------------------------- title
      new Paragraph({
        spacing: { after: 60 },
        children: [new TextRun({ text: 'Navixa', bold: true, size: 44, color: INK, font: 'Calibri' })],
      }),
      new Paragraph({
        spacing: { after: 40 },
        children: [new TextRun({ text: 'Demo Video Script — 3 to 4 minutes', size: 26, color: ORANGE, font: 'Calibri' })],
      }),
      P('For: Builders Pitch Fest 2026 — Prototype / MVP submission', { color: MUTED, size: 20, after: 60 }),
      P('Live product: navixa-woad.vercel.app', { color: MUTED, size: 20, after: 200 }),
      Rule(),

      // ---------------------------------------------------------- prep
      H1('Before you hit record'),
      P('Prepare the account so nothing is empty on screen. An empty tracker or a blank resume kills a demo. Ten minutes of prep:', { after: 140 }),
      Bullet('Sign in and complete onboarding with a real target role (e.g. Frontend Engineer).'),
      Bullet('Fill the resume: name, headline, one or two experience entries with real bullets, education, six to eight skills. It appears on three different screens.'),
      Bullet('Save four or five jobs. Move two into Applied and one into Interview so the tracker and its analytics have something to show.'),
      Bullet('Open the Learn page once so it is not cold.'),
      Bullet('Set a leaderboard username in Settings so that screen is not blank.'),

      H2('Technical setup'),
      Bullet('Record at 1920 × 1080, browser full screen, zoom at 100% (Cmd+0).'),
      Bullet('Use a clean Chrome profile: no bookmarks bar, no extensions, one tab.'),
      Bullet('Close Slack and Mail — no notification banners mid-take.'),
      Bullet('Tools: OBS Studio (free), or QuickTime → File → New Screen Recording on Mac.'),
      Bullet('Record screen and voice in one pass if you are comfortable; otherwise record silently and narrate over it. Live narration is faster and sounds more natural.'),
      Bullet('Speak about 15% slower than feels normal. Everyone rushes on camera.'),
      Rich([['Do not ', { bold: true }],
            ['show sign-in with your real Google account on camera — start already signed in. It wastes fifteen seconds and shows your email address.', {}]],
           { before: 100, after: 60 }),
      Rule(),

      // ---------------------------------------------------------- script
      H1('The script'),
      P('Timings are targets, not rules. Total is about 3 minutes 30 seconds.', { color: MUTED, italics: true, after: 60 }),

      Timing('0:00 – 0:25', 'The problem'),
      ShowBox(['A browser with four or five tabs open — LinkedIn, a Google Doc resume, a spreadsheet, ChatGPT. Just a few seconds of it.']),
      P('Say:', { bold: true, before: 140, after: 80, color: MUTED, size: 19 }),
      Say('“This is what a job search actually looks like. A job board in one tab, my resume in another, a spreadsheet tracking who I’ve applied to, and a chatbot I re-explain myself to every single time.'),
      Say('None of these tools know about each other. My resume doesn’t know what the job asked for. The AI doesn’t know what’s on my resume. And nothing remembers what already worked.'),
      Say('That’s the problem Navixa solves.”'),

      Timing('0:25 – 0:45', 'What it is'),
      ShowBox(['Navigate to the Navixa dashboard. Let it load. Move the mouse slowly down the sidebar so viewers register the sections.']),
      P('Say:', { bold: true, before: 140, after: 80, color: MUTED, size: 19 }),
      Say('“Navixa is one workspace where every part of the job search shares the same context. Job search, resume, application tracker, interview prep — all reading from each other. It’s live, it’s free, and it runs entirely in the browser.”'),

      Timing('0:45 – 1:25', 'Job search → tailoring   (the core loop — spend time here)'),
      ShowBox([
        'Click Job search. Let real listings load. Scroll a little. Point at the match percentage on a card.',
        'Then click the tailor icon on a job that matches your resume. Wait for the result — do not cut away. Point at the match score, the missing keywords, then a suggested bullet rewrite.',
      ]),
      P('Say:', { bold: true, before: 140, after: 80, color: MUTED, size: 19 }),
      Say('“Job search pulls live listings from four public boards, removes duplicates, and scores each one against my actual skills.'),
      Say('Now here’s the part that matters. Instead of rewriting my resume by hand for this posting…'),
      Say('…Navixa reads the posting and my resume together. It gives me a match score, tells me which keywords I’m missing, and rewrites my bullets to fit this specific role. One click applies it straight into my resume.'),
      Say('That’s about thirty minutes of work, done in under a minute.”'),

      Timing('1:25 – 2:00', 'Tracker   (proof it is a real product)'),
      ShowBox([
        'Click Tracker. Drag a card from Applied to Interview. Scroll to the insights panel.',
        'Then click the follow-up icon on a stale card.',
      ]),
      P('Say:', { bold: true, before: 140, after: 80, color: MUTED, size: 19 }),
      Say('“Every application lands on the tracker. As I move cards through the stages, Navixa records what actually happened — response rate, how long each stage takes, which sources convert.'),
      Say('And when something’s gone quiet, it drafts the follow-up email for me.'),
      Say('This history is the part I care most about long term. It’s the difference between advice that’s generic and advice that knows my track record.”'),

      Timing('2:00 – 2:45', 'Interview prep   (your strongest moment)'),
      ShowBox([
        'Open Interview prep from a tracker card or the AI chat page. Paste a job description. Let the questions generate.',
        'Scroll to a “Gap probe” question and PAUSE on it — this is the best moment in the demo, let it breathe.',
        'Then click Practise this → record. Answer out loud for about fifteen seconds; genuinely answer, do not mumble. Stop, then click Get feedback and let the score and metrics appear.',
      ]),
      P('Say:', { bold: true, before: 140, after: 80, color: MUTED, size: 19 }),
      Say('“Interview prep is where the shared context really pays off. It reads the job description against my resume and generates the questions I’m actually likely to face.'),
      Say('Including these — ‘gap probes’. It found that this role wants GraphQL and my resume doesn’t have it, so it’s forcing me to prepare for exactly the question I’d otherwise get blindsided by.'),
      Say('I can practise out loud. It transcribes me in the browser, times me, and tracks my pace and filler words — all computed locally.'),
      Say('Then it scores the answer and tells me what to sharpen.”'),

      Timing('2:45 – 3:10', 'Momentum and privacy'),
      ShowBox(['Click Streaks. Show the streak, then scroll to the leaderboard. Then briefly show Settings → the username field and opt-in toggle.']),
      P('Say:', { bold: true, before: 140, after: 80, color: MUTED, size: 19 }),
      Say('“Job hunting is a grind, so Navixa tracks streaks and XP, with a leaderboard for a bit of momentum.'),
      Say('Two things there. Scores are computed on the server, so they can’t be faked. And the leaderboard is opt-in and shows only a username you choose — never your real name or email.”'),

      Timing('3:10 – 3:30', 'Close'),
      ShowBox(['Back to the dashboard. Hold still on it.']),
      P('Say:', { bold: true, before: 140, after: 80, color: MUTED, size: 19 }),
      Say('“Navixa is live today at navixa-woad.vercel.app — a working product, not a mockup. Over a hundred and fifty automated tests, a documented security audit, and every AI feature falls back gracefully when the model is unavailable.'),
      Say('One workspace, one context, for everyone doing this alone.'),
      Say('Thanks for watching.”'),
      Rule(),

      // ---------------------------------------------------------- tips
      H1('Recording tips that actually matter'),
      Rich([['Do it in sections. ', { bold: true }], ['Record each section separately and stitch them. One continuous three-minute perfect take is not worth chasing.', {}]], { after: 130 }),
      Rich([['Wait for loading, do not cut it. ', { bold: true }], ['Judges are suspicious of demos that cut away at every load. Letting a real API call resolve on camera proves it is real. If a call takes more than about four seconds, speed that clip to 2× rather than cutting.', {}]], { after: 130 }),
      Rich([['Mouse discipline. ', { bold: true }], ['Move deliberately and pause before clicking. A frantic cursor makes a product look chaotic.', {}]], { after: 130 }),
      Rich([['Do not narrate the UI. ', { bold: true }], ['Say why, not what. “It found the gap in my resume” beats “now I’m clicking the interview prep button.”', {}]], { after: 130 }),
      Rich([['If a feature errors on camera, ', { bold: true }], ['do not panic-cut — the free AI gateway is occasionally rate-limited. Re-record just that section later.', {}]], { after: 130 }),
      Rich([['Captions. ', { bold: true }], ['Add them if you can. Many judges watch muted first.', {}]], { after: 130 }),

      H1('Cutting to 3:00 flat if you need to'),
      P('Drop these in order:', { after: 120 }),
      Bullet('The Streaks / leaderboard section (saves 0:25) — nice, not essential.'),
      Bullet('The follow-up-email beat in Tracker (saves 0:10).'),
      Bullet('Shorten the problem intro to two sentences (saves 0:10).'),
      Rich([['Never cut ', { bold: true, color: ORANGE }],
            ['the tailoring section or the gap-probe moment. Those two are the whole differentiator.', {}]],
           { before: 100, after: 140 }),

      H1('Checklist before uploading'),
      Bullet('Audio is audible and free of background hum.'),
      Bullet('No email address, real name or Google account visible anywhere.'),
      Bullet('No browser notifications appeared mid-take.'),
      Bullet('Runs under five minutes (the brief asks for three to five).'),
      Bullet('Uploaded unlisted to YouTube or Drive, with link sharing ON — test the link in a private window before submitting.'),
      Bullet('Link added to slide 12 of the pitch deck.'),
    ],
  }],
});

Packer.toBuffer(doc).then((buf) => {
  const out = process.argv[2] || 'Navixa_Demo_Video_Script.docx';
  fs.writeFileSync(out, buf);
  console.log('wrote ' + out);
});
