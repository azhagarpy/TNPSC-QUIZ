import { useState } from 'react';
import { useI18n } from '../lib/i18n';
import { useRouter } from '../lib/router';
import { Button, Field, Screen, inputClass } from '../components/ui';

export default function JoinRoom() {
  const { t } = useI18n();
  const { navigate } = useRouter();
  const [code, setCode] = useState('');
  const valid = /^[A-HJ-NP-Z2-9]{6}$/.test(code);
  return (
    <Screen title={t('room.join')} back="/">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) navigate(`/r/${code}`);
        }}
      >
        <Field label={t('room.codeLabel')}>
          <input
            className={`${inputClass} text-center font-mono text-3xl font-black tracking-[0.4em] uppercase`}
            value={code}
            maxLength={6}
            autoFocus
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            inputMode="text"
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, ''))}
          />
        </Field>
        <Button block size="lg" type="submit" disabled={!valid}>
          {t('room.joinBtn')}
        </Button>
      </form>
    </Screen>
  );
}
