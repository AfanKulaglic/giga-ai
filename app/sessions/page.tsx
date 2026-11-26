import { redirect } from 'next/navigation';

/**
 * Stranica „Sesije” je ukinuta: asistent drži jedan razgovor i dugme „Reset”.
 * Stara putanja preusmjerava na radni prostor da bookmark ne pukne.
 */
export default function SessionsPage() {
  redirect('/');
}
