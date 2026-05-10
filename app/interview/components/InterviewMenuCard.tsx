import Link from 'next/link';

type Props = {
  title: string;
  description: string;
  buttonLabel: string;
  href: string;
};

export function InterviewMenuCard({ title, description, buttonLabel, href }: Props) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-6">
      <h2 className="text-base font-semibold text-gray-800 mb-2">{title}</h2>
      <p className="text-sm text-gray-600 leading-relaxed mb-5">{description}</p>
      <Link
        href={href}
        className="inline-block bg-blue-600 hover:bg-blue-700 text-white font-semibold px-5 py-2.5 rounded-lg text-sm transition-colors"
      >
        {buttonLabel}
      </Link>
    </div>
  );
}
