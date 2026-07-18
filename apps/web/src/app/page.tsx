import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';

export default async function Home() {
  const jar = await cookies();
  redirect(jar.get('eyo_token') ? '/dashboard' : '/login');
}
