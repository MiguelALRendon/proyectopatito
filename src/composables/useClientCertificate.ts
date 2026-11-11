import { ref, type Ref } from 'vue';
import { normalizeError, pickFile, type CommandError } from '../services/tauri';
import { CLIENT_CERT_FILTERS } from '../utils/certFilters';

export const PASSPHRASE_REQUIRED = 'Indica la frase de paso del certificado.';

export interface ClientCertFields {
  client_cert: string | null;
  client_cert_passphrase: string | null;
}

export function useClientCertificate(
  initialPath: string | null,
  passphraseInput: Readonly<Ref<HTMLInputElement | null>>,
) {
  const path = ref(initialPath);
  const passphraseError = ref<string | null>(null);
  const pickError = ref<CommandError | null>(null);

  async function choose() {
    pickError.value = null;
    try {
      const picked = await pickFile(CLIENT_CERT_FILTERS);
      if (picked !== null) path.value = picked;
    } catch (raw) {
      pickError.value = normalizeError(raw);
    }
  }

  function remove() {
    path.value = null;
    passphraseError.value = null;
    pickError.value = null;
  }

  const readPassphrase = () => passphraseInput.value?.value ?? '';

  function wipePassphrase() {
    if (passphraseInput.value) passphraseInput.value.value = '';
  }

  function clearPassphraseError() {
    passphraseError.value = null;
  }

  function validate(): boolean {
    if (path.value === null || readPassphrase() !== '') return true;
    passphraseError.value = PASSPHRASE_REQUIRED;
    passphraseInput.value?.focus();
    return false;
  }

  function fields(): ClientCertFields {
    const passphrase = readPassphrase();
    return {
      client_cert: path.value,
      client_cert_passphrase:
        path.value !== null && passphrase !== '' ? passphrase : null,
    };
  }

  return {
    path,
    passphraseError,
    pickError,
    choose,
    remove,
    wipePassphrase,
    clearPassphraseError,
    validate,
    fields,
  };
}
