// Care+ entry point — the "Care+" wordmark set in Nico Moji (self-hosted), with a
// purple→magenta gradient on "Care" and a raised magenta "+". Centered; links to
// the /care-plus page.
import Link from 'next/link';

export default function CarePlusLink({ isElderly }: { isElderly?: boolean }) {
  const careSize = isElderly ? '2.4rem' : '1.9rem';
  const plusSize = isElderly ? '2.7rem' : '2.15rem';

  return (
    <div className="text-center">
      <Link
        href="/care-plus"
        aria-label="Open Care+"
        className="inline-flex items-center leading-none select-none hover:opacity-90 transition-opacity"
        style={{ fontFamily: "'Nico Moji', var(--font-sans)" }}
      >
        <span
          style={{
            fontSize: careSize,
            background: 'linear-gradient(96deg, #A22FBE 0%, #C42BAE 44%, #E0299C 78%, #EC2E90 100%)',
            WebkitBackgroundClip: 'text',
            backgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
          }}
        >
          Care
        </span>
        <span
          style={{
            fontSize: plusSize,
            color: '#EA2A8E',
            marginLeft: '0.04em',
            transform: 'translateY(-0.06em)',
            lineHeight: 1,
          }}
        >
          +
        </span>
      </Link>
    </div>
  );
}
