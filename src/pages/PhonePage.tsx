import { useSearchParams } from 'react-router-dom';
import { ErrorBoundary } from '../apps/bedside-glance/ErrorBoundary';
import { PhoneApp } from '../apps/bedside-glance/phone/PhoneApp';

const SESSION_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function PhonePage() {
  const [params] = useSearchParams();
  const raw = params.get('session') ?? 'demo';
  const sessionId = SESSION_ID.test(raw) ? raw : 'demo';
  return (
    <ErrorBoundary>
      <PhoneApp sessionId={sessionId} directorOpen={params.get('director') === '1'} scanOpen={params.get('scan') === '1'} />
    </ErrorBoundary>
  );
}
