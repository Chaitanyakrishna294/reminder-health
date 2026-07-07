// Care+ entry point — the "Care+" wordmark set in Nico Moji (self-hosted), with the
// brand rose ramp on "Care" and a raised deep-rose "+". Centered; links to the
// /care-plus page.
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
            backgroundImage: 'linear-gradient(96deg, #F8839E 0%, #F26B8A 55%, #ED5276 100%)',
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
            color: '#ED5276',
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
