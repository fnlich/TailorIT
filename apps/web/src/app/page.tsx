import { redirect } from 'next/navigation';

// proxy.ts already sends "/" on (to /jobs, or to sign-in); this covers a request it did not see.
export default function Home() {
  redirect('/jobs');
}
