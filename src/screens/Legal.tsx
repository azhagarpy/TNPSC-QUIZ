import { useI18n } from '../lib/i18n';
import { Screen } from '../components/ui';

// Template terms and privacy policy, adapted to this game's rules. Have them
// checked by a lawyer (plan: gaming-law opinion) before public launch.
const CONTACT = (import.meta.env.VITE_CONTACT_EMAIL as string | undefined) || 'the support email listed on this site';
const UPDATED = '8 October 2026';
// Where the Supabase project lives, e.g. "Mumbai, India" (set VITE_DATA_REGION).
const REGION = (import.meta.env.VITE_DATA_REGION as string | undefined) || '';

const TERMS_EN: [string, string][] = [
  ['Who can play', 'You must be 18 or older. One account per person.'],
  [
    'Coins are free game points',
    'Coins are earned only by playing. They cannot be bought, sold, transferred or gifted to another player, and they can never be exchanged for money, recharge, vouchers or prizes. They have no value outside the game and we may adjust balances to fix errors or abuse.',
  ],
  [
    'Rooms',
    'In a room every player puts in the same entry coins. The pot is paid out by rank after a 10% reduction, and a failed match is refunded. There is a daily limit of 5,000 entry coins. This is a game of knowledge for practice and fun, not a money game.',
  ],
  [
    'Fair play',
    'Do not use bots, multiple accounts, shared answers or deliberate losing to move coins. We may freeze coins or close accounts that break these rules.',
  ],
  [
    'Chat',
    'Be respectful. Links, phone numbers, UPI IDs and abusive words are blocked. Reports are reviewed; repeated upheld reports pause chat for 24 hours.',
  ],
  [
    'Questions',
    'We check every question with two reviewers, but mistakes can happen. Use “Report question”; if we uphold your report you get 20 coins. Questions are practice material and do not represent TNPSC.',
  ],
  ['Not affiliated', 'This app is an independent practice tool and is not connected with the Tamil Nadu Public Service Commission.'],
  ['Changes', `We may update these terms; the date above shows the latest version. Contact: ${CONTACT}.`],
];

const TERMS_TA = [
  '18 வயது நிரம்பியவர்கள் மட்டும்; ஒருவருக்கு ஒரு கணக்கு.',
  'நாணயங்கள் விளையாடுவதன் மூலம் மட்டுமே கிடைக்கும் இலவசப் புள்ளிகள். அவற்றை வாங்கவோ, விற்கவோ, பிறருக்கு மாற்றவோ, பணம்/ரீசார்ஜ்/பரிசாக மாற்றவோ முடியாது.',
  'அறைப் போட்டியில் அனைவரும் ஒரே நுழைவுத் தொகை செலுத்துவர்; 10% குறைத்து மீதம் தரவரிசைப்படி வழங்கப்படும். தோல்வியடைந்த போட்டிக்கு முழுத் தொகை திருப்பித் தரப்படும். நாளொன்றுக்கு 5,000 நாணய வரம்பு.',
  'பல கணக்குகள், விடைகளைப் பகிர்தல், வேண்டுமென்றே தோற்று நாணயம் மாற்றுதல் தடை.',
  'அரட்டையில் இணைப்புகள், தொலைபேசி எண்கள், UPI முகவரிகள், அவதூறுச் சொற்கள் தடுக்கப்படும்.',
  'இது TNPSC-யுடன் தொடர்பில்லாத சுயாதீனப் பயிற்சிச் செயலி.',
];

const PRIVACY_EN: [string, string][] = [
  [
    'What we collect',
    'Your email (for sign-in), name, username, district and target exam year. We also keep your game activity: answers, scores, coins, friends and chat messages. We do not collect your phone number, contacts or location.',
  ],
  ['Why', 'To run your account, the game, leaderboards and study reports, and to prevent cheating (for example, a hashed device fingerprint limits repeat sign-up bonuses).'],
  ['Where', `Data is stored with Supabase${REGION ? ` in its ${REGION} region` : ''}. The app is served through Cloudflare.`],
  ['Notifications', 'If you turn on notifications, we store your browser’s push address to send room invites, friend requests and streak reminders. Turn them off any time in Profile.'],
  ['Crash reports and analytics', 'When the app crashes, a technical error report (no email, name or chat) is sent to Sentry so we can fix it. Anonymous usage analytics (PostHog) run only if you opt in, and you can switch them off in Profile. Both use your random user id, never your email.'],
  ['How long', 'Chat messages are deleted after 30 days. Everything else is kept while your account exists.'],
  ['Your choices', 'You can edit your profile at any time and delete your account from Profile → Delete my account. Deletion removes your data permanently.'],
  ['Children', 'The app is for people aged 18 and over. We do not knowingly collect data from children.'],
  ['Contact', `Questions or requests under the Digital Personal Data Protection Act, 2023: ${CONTACT}.`],
];

const PRIVACY_TA = [
  'மின்னஞ்சல், பெயர், பயனர் பெயர், மாவட்டம், தேர்வு ஆண்டு மற்றும் உங்கள் விளையாட்டுச் செயல்பாடுகள் மட்டுமே சேமிக்கப்படும்.',
  'தொலைபேசி எண், தொடர்புகள், இருப்பிடம் சேகரிக்கப்படுவதில்லை.',
  `தரவுகள் Supabase சேவையகத்தில்${REGION ? ` (${REGION})` : ''} சேமிக்கப்படும்.`,
  'அரட்டைச் செய்திகள் 30 நாட்களில் நீக்கப்படும்.',
  'பிழை அறிக்கைகள் (Sentry) மின்னஞ்சல், பெயர் இல்லாமல் அனுப்பப்படும்; பயன்பாட்டுப் பகுப்பாய்வு (PostHog) நீங்கள் ஒப்புக்கொண்டால் மட்டும்.',
  'சுயவிவரப் பக்கத்திலிருந்து உங்கள் கணக்கை எப்போது வேண்டுமானாலும் நிரந்தரமாக நீக்கலாம்.',
];

export default function Legal({ params }: { params: Record<string, string> }) {
  const { t, lang } = useI18n();
  const terms = params.page === 'terms';
  const sections = terms ? TERMS_EN : PRIVACY_EN;
  const summary = terms ? TERMS_TA : PRIVACY_TA;
  const tamilBlock = (
    <section className="rounded-2xl bg-surface-2 p-4" lang="ta">
      <h2 className="mb-2 font-bold">சுருக்கம்</h2>
      <ul className="list-disc space-y-1 pl-5 text-sm">
        {summary.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ul>
    </section>
  );
  return (
    <Screen title={terms ? t('profile.terms') : t('profile.privacy')} back="/">
      <div className="space-y-4 pb-8">
        <p className="text-xs text-muted">Last updated {UPDATED}</p>
        {lang === 'ta' && tamilBlock}
        {sections.map(([h, body]) => (
          <section key={h} lang="en">
            <h2 className="font-bold">{h}</h2>
            <p className="text-sm">{body}</p>
          </section>
        ))}
        {lang === 'en' && tamilBlock}
      </div>
    </Screen>
  );
}
