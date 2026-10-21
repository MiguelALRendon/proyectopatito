import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import type { FileProbe } from '../../services/filesApi';
import MediaPlayer from './MediaPlayer.vue';

const PATH = 'wc\\sonido.mp3';

function probeOf(extra: Partial<FileProbe> = {}): FileProbe {
  return {
    kind: 'audio',
    mime: 'audio/mpeg',
    len: 2048,
    extension: 'mp3',
    has_macros: false,
    version: null,
    ...extra,
  };
}

const VIDEO = probeOf({
  kind: 'video',
  mime: 'video/mp4',
  extension: 'mp4',
  len: 4096,
});

interface Control {
  paused: boolean;
  currentTime: number;
  duration: number;
  muted: boolean;
  volume: number;
  error: { code: number } | null;
  videoWidth: number;
  videoHeight: number;
}

let wrapper: VueWrapper;
let canPlay: CanPlayTypeResult;
const play = vi.fn();
const pause = vi.fn();
const load = vi.fn();
const requestFullscreen = vi.fn();

function mountPlayer(probe = probeOf(), path = PATH) {
  wrapper = mount(MediaPlayer, {
    props: { path, probe },
    attachTo: document.body,
  });
}

function element(): HTMLMediaElement {
  return wrapper.get('audio, video').element as HTMLMediaElement;
}

function control(extra: Partial<Control> = {}): Control {
  const state: Control = {
    paused: true,
    currentTime: 0,
    duration: Number.NaN,
    muted: false,
    volume: 1,
    error: null,
    videoWidth: 0,
    videoHeight: 0,
    ...extra,
  };
  const media = element();
  for (const key of Object.keys(state) as (keyof Control)[]) {
    Object.defineProperty(media, key, {
      configurable: true,
      get: () => state[key],
      set: (value) => {
        (state as unknown as Record<string, unknown>)[key] = value;
      },
    });
  }
  return state;
}

async function fire(name: string) {
  element().dispatchEvent(new Event(name));
  await wrapper.vm.$nextTick();
}

function press(key: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  wrapper.get('[role="group"][tabindex="0"]').element.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  canPlay = 'probably';
  vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockImplementation(
    () => canPlay,
  );
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(
    play.mockResolvedValue(undefined),
  );
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(pause);
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(load);
  Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', {
    configurable: true,
    value: requestFullscreen.mockResolvedValue(undefined),
  });
});

afterEach(() => {
  wrapper?.unmount();
  vi.restoreAllMocks();
  play.mockReset();
  pause.mockReset();
  load.mockReset();
  requestFullscreen.mockReset();
});

describe('MediaPlayer: lo que no se puede reproducir, primero', () => {
  it('un formato que el WebView no reconoce va directo a la tarjeta, sin elemento de medio', () => {
    canPlay = '';
    mountPlayer(probeOf({ mime: 'video/x-msvideo', kind: 'video' }));
    expect(wrapper.find('audio, video').exists()).toBe(false);
    expect(wrapper.get('article').text()).toContain('no reconoce el formato');
  });

  it.each([
    [4, 'no es compatible'],
    [3, 'dañado'],
    [2, 'No se pudo leer el archivo'],
    [1, 'interrumpió'],
    [0, 'no es compatible'],
  ])(
    'el error %d del elemento muestra la tarjeta con su motivo',
    async (code, text) => {
      mountPlayer();
      control({ error: { code } });
      await fire('error');
      expect(wrapper.get('article').text()).toContain(text);
      expect(wrapper.find('audio, video').exists()).toBe(false);
    },
  );

  it('un error sin código también cae a la tarjeta', async () => {
    mountPlayer();
    control({ error: null });
    await fire('error');
    expect(wrapper.get('article').text()).toContain('no es compatible');
  });

  it('la tarjeta conserva la duración y las dimensiones que llegaron antes del error', async () => {
    mountPlayer(VIDEO, 'wc\\clip.mp4');
    const state = control({ duration: 65, videoWidth: 640, videoHeight: 360 });
    await fire('loadedmetadata');
    state.error = { code: 3 };
    await fire('error');
    const text = wrapper.get('article').text();
    expect(text).toContain('Duración');
    expect(text).toContain('1:05');
    expect(text).toContain('640 × 360 px');
  });

  it('sin metadatos la tarjeta no inventa duración ni dimensiones', async () => {
    mountPlayer();
    control({ error: { code: 4 } });
    await fire('error');
    const text = wrapper.get('article').text();
    expect(text).not.toContain('Duración');
    expect(text).not.toContain('Dimensiones');
  });

  it('las teclas con Ctrl, Alt o Meta no las toma el reproductor', () => {
    mountPlayer();
    const state = control({ duration: 60 });
    for (const init of [
      { ctrlKey: true },
      { altKey: true },
      { metaKey: true },
    ]) {
      expect(press('ArrowRight', init).defaultPrevented).toBe(false);
    }
    expect(state.currentTime).toBe(0);
  });

  it('una tecla que no es suya no se bloquea', () => {
    mountPlayer();
    control();
    expect(press('Tab').defaultPrevented).toBe(false);
    expect(press('constructor').defaultPrevented).toBe(false);
  });

  it('buscar no pasa de la duración ni baja de cero', async () => {
    mountPlayer();
    const state = control({ duration: 8, currentTime: 6 });
    await fire('loadedmetadata');
    press('ArrowRight');
    expect(state.currentTime).toBe(8);
    state.currentTime = 2;
    press('ArrowLeft');
    expect(state.currentTime).toBe(0);
  });

  it('con duración infinita (una transmisión) el control de posición está desactivado', async () => {
    mountPlayer();
    control({ duration: Number.POSITIVE_INFINITY });
    await fire('loadedmetadata');
    expect(
      wrapper.get('input[aria-label="Posición"]').attributes('disabled'),
    ).toBeDefined();
  });

  it('al desmontar libera el archivo: pausa, quita el origen y recarga', () => {
    mountPlayer();
    control();
    const removeSource = vi.spyOn(element(), 'removeAttribute');
    wrapper.unmount();
    expect(pause).toHaveBeenCalled();
    expect(removeSource).toHaveBeenCalledWith('src');
    expect(load).toHaveBeenCalled();
    mountPlayer();
  });

  it('un error anterior no sobrevive al cambiar de archivo', async () => {
    mountPlayer();
    control({ error: { code: 4 } });
    await fire('error');
    expect(wrapper.find('article').exists()).toBe(true);
    await wrapper.setProps({ path: 'wc\\otro.mp3' });
    expect(wrapper.find('article').exists()).toBe(false);
    expect(wrapper.find('audio').exists()).toBe(true);
  });
});

describe('MediaPlayer: reproducir, pausar y buscar', () => {
  it('un audio carga solo los metadatos, sin reproducción automática y desde el protocolo', () => {
    mountPlayer();
    const media = element();
    expect(media.tagName).toBe('AUDIO');
    expect(media.getAttribute('preload')).toBe('metadata');
    expect(media.hasAttribute('autoplay')).toBe(false);
    expect(media.getAttribute('src')).toContain('workspace-file.localhost');
    expect(media.getAttribute('src')).toContain('sonido.mp3');
  });

  it('un vídeo usa un elemento video y ofrece pantalla completa; un audio no', () => {
    mountPlayer(VIDEO, 'wc\\clip.mp4');
    expect(element().tagName).toBe('VIDEO');
    expect(
      wrapper.find('button[aria-label="Pantalla completa"]').exists(),
    ).toBe(true);
    wrapper.unmount();
    mountPlayer();
    expect(
      wrapper.find('button[aria-label="Pantalla completa"]').exists(),
    ).toBe(false);
  });

  it('al llegar los metadatos muestra la duración y activa la posición', async () => {
    mountPlayer();
    control({ duration: 65 });
    await fire('loadedmetadata');
    expect(wrapper.get('.media-player__time').text()).toBe('0:00 de 1:05');
    const slider = wrapper.get('input[aria-label="Posición"]');
    expect(slider.attributes('disabled')).toBeUndefined();
    expect(slider.attributes('aria-valuetext')).toBe('0:00 de 1:05');
  });

  it('el botón reproduce y, cuando suena, ofrece pausar', async () => {
    mountPlayer();
    control();
    await wrapper.get('button[aria-label="Reproducir"]').trigger('click');
    expect(play).toHaveBeenCalledTimes(1);
    await fire('play');
    expect(wrapper.find('button[aria-label="Pausar"]').exists()).toBe(true);
    await fire('pause');
    expect(wrapper.find('button[aria-label="Reproducir"]').exists()).toBe(true);
  });

  it('con el medio sonando el botón y la barra espaciadora pausan', async () => {
    mountPlayer();
    control({ paused: false });
    await fire('play');
    press(' ');
    expect(pause).toHaveBeenCalledTimes(1);
    await wrapper.get('button[aria-label="Pausar"]').trigger('click');
    expect(pause).toHaveBeenCalledTimes(2);
    expect(play).not.toHaveBeenCalled();
  });

  it('la barra espaciadora reproduce si estaba en pausa y no deja pasar el desplazamiento', () => {
    mountPlayer();
    control();
    const event = press(' ');
    expect(event.defaultPrevented).toBe(true);
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('si el navegador rechaza reproducir no revienta', async () => {
    mountPlayer();
    control();
    play.mockRejectedValue(new Error('NotAllowedError'));
    await wrapper.get('button[aria-label="Reproducir"]').trigger('click');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(play).toHaveBeenCalledTimes(1);
    expect(wrapper.find('article').exists()).toBe(false);
    expect(wrapper.find('button[aria-label="Reproducir"]').exists()).toBe(true);
  });

  it('las flechas buscan cinco segundos y el tiempo avanza con timeupdate', async () => {
    mountPlayer();
    const state = control({ duration: 60, currentTime: 10 });
    await fire('loadedmetadata');
    press('ArrowRight');
    expect(state.currentTime).toBe(15);
    press('ArrowLeft');
    expect(state.currentTime).toBe(10);
    state.currentTime = 42;
    await fire('timeupdate');
    expect(wrapper.get('.media-player__time').text()).toBe('0:42 de 1:00');
  });

  it('el control de posición busca al valor elegido', async () => {
    mountPlayer();
    const state = control({ duration: 60 });
    await fire('loadedmetadata');
    const slider = wrapper.get('input[aria-label="Posición"]');
    (slider.element as HTMLInputElement).value = '30';
    await slider.trigger('input');
    expect(state.currentTime).toBe(30);
  });

  it('M silencia y vuelve a activar el sonido, y el botón refleja el estado', async () => {
    mountPlayer();
    const state = control();
    press('m');
    expect(state.muted).toBe(true);
    await fire('volumechange');
    expect(
      wrapper
        .find('button[aria-label="Activar sonido"]')
        .attributes('aria-pressed'),
    ).toBe('true');
    press('M');
    expect(state.muted).toBe(false);
  });

  it('las flechas arriba y abajo cambian el volumen en pasos y respetan los límites', () => {
    mountPlayer();
    const state = control({ volume: 0.5 });
    press('ArrowUp');
    expect(state.volume).toBe(0.6);
    press('ArrowDown');
    press('ArrowDown');
    expect(state.volume).toBe(0.4);
    state.volume = 1;
    press('ArrowUp');
    expect(state.volume).toBe(1);
    state.volume = 0;
    press('ArrowDown');
    expect(state.volume).toBe(0);
  });

  it('subir el volumen con el sonido silenciado lo reactiva', () => {
    mountPlayer();
    const state = control({ volume: 0.3, muted: true });
    press('ArrowUp');
    expect(state.muted).toBe(false);
  });

  it('el control de volumen cambia el volumen', async () => {
    mountPlayer();
    const state = control();
    const slider = wrapper.get('input[aria-label="Volumen"]');
    (slider.element as HTMLInputElement).value = '0.7';
    await slider.trigger('input');
    expect(state.volume).toBe(0.7);
  });

  it('F pide pantalla completa solo en vídeo', () => {
    mountPlayer(VIDEO, 'wc\\clip.mp4');
    control();
    press('f');
    expect(requestFullscreen).toHaveBeenCalledTimes(1);
    wrapper.unmount();
    mountPlayer();
    control();
    press('F');
    expect(requestFullscreen).toHaveBeenCalledTimes(1);
  });

  it('el botón de pantalla completa sale de ella si ya está activa', () => {
    mountPlayer(VIDEO, 'wc\\clip.mp4');
    control();
    const exit = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      value: document.body,
    });
    Object.defineProperty(document, 'exitFullscreen', {
      configurable: true,
      value: exit,
    });
    press('f');
    expect(exit).toHaveBeenCalledTimes(1);
    Reflect.deleteProperty(document, 'fullscreenElement');
  });

  it('el estado de pantalla completa sigue a fullscreenchange', async () => {
    mountPlayer(VIDEO, 'wc\\clip.mp4');
    control();
    const stage = wrapper.get('[role="group"][tabindex="0"]').element;
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      value: stage,
    });
    document.dispatchEvent(new Event('fullscreenchange'));
    await wrapper.vm.$nextTick();
    expect(
      wrapper
        .get('button[aria-label="Pantalla completa"]')
        .attributes('aria-pressed'),
    ).toBe('true');
    Reflect.deleteProperty(document, 'fullscreenElement');
  });

  it('las dimensiones del vídeo aparecen en la barra de estado', async () => {
    mountPlayer(VIDEO, 'wc\\clip.mp4');
    control({ duration: 10, videoWidth: 1280, videoHeight: 720 });
    await fire('loadedmetadata');
    expect(wrapper.text()).toContain('1280 × 720 px');
    expect(wrapper.text()).toContain('video/mp4');
  });
});

describe('MediaPlayer: estados de la reproducción', () => {
  it('al cambiar de archivo se reinician duración, posición, dimensiones y estado', async () => {
    mountPlayer(VIDEO, 'wc\a.mp4');
    control({
      duration: 100,
      currentTime: 30,
      videoWidth: 640,
      videoHeight: 480,
      paused: false,
    });
    await fire('loadedmetadata');
    await fire('timeupdate');
    await fire('play');
    expect(wrapper.get('.media-player__time').text()).toBe('0:30 de 1:40');
    await wrapper.setProps({ path: 'wc\b.mp4' });
    expect(wrapper.get('.media-player__time').text()).toBe('0:00 de --:--');
    expect(wrapper.get('.media-player__facts').text()).not.toContain('640');
    expect(wrapper.find('button[aria-label="Reproducir"]').exists()).toBe(true);
  });

  it('con el sonido silenciado el control de volumen muestra cero', async () => {
    mountPlayer();
    control({ muted: true, volume: 0.8 });
    await fire('volumechange');
    const slider = wrapper.get('input[aria-label="Volumen"]');
    expect((slider.element as HTMLInputElement).value).toBe('0');
  });

  it('al desmontar se retira el listener de fullscreenchange', () => {
    mountPlayer();
    const remove = vi.spyOn(document, 'removeEventListener');
    wrapper.unmount();
    expect(remove).toHaveBeenCalledWith(
      'fullscreenchange',
      expect.any(Function),
    );
    mountPlayer();
  });

  it('con la duración desconocida las flechas no buscan', async () => {
    mountPlayer();
    const state = control({ duration: Number.NaN, currentTime: 10 });
    await fire('loadedmetadata');
    press('ArrowRight');
    press('ArrowLeft');
    await wrapper.vm.$nextTick();
    expect(state.currentTime).toBe(10);
  });

  it('al cambiar de archivo libera el anterior: pausa, quita el origen y recarga', async () => {
    mountPlayer(probeOf(), 'wc/uno.mp3');
    const previous = element();
    const removeSource = vi.spyOn(previous, 'removeAttribute');
    await wrapper.setProps({ path: 'wc/dos.mp3' });
    expect(pause).toHaveBeenCalled();
    expect(removeSource).toHaveBeenCalledWith('src');
    expect(load).toHaveBeenCalled();
  });

  it('buscar mientras suena no la detiene', async () => {
    mountPlayer();
    const state = control({ paused: false, duration: 100, currentTime: 10 });
    await fire('loadedmetadata');
    await fire('play');
    press('ArrowRight');
    expect(state.currentTime).toBe(15);
    expect(pause).not.toHaveBeenCalled();
    expect(wrapper.find('button[aria-label="Pausar"]').exists()).toBe(true);
  });

  it('buscar en pausa no la reanuda', async () => {
    mountPlayer();
    const state = control({ paused: true, duration: 100, currentTime: 10 });
    await fire('loadedmetadata');
    press('ArrowRight');
    await wrapper.vm.$nextTick();
    expect(state.currentTime).toBe(15);
    expect(play).not.toHaveBeenCalled();
    expect(wrapper.find('button[aria-label="Reproducir"]').exists()).toBe(true);
  });

  it('al terminar vuelve a ofrecer reproducir, y reproducir de nuevo arranca otra vez', async () => {
    mountPlayer();
    const state = control({ paused: false, duration: 100, currentTime: 100 });
    await fire('play');
    state.paused = true;
    await fire('ended');
    expect(wrapper.find('button[aria-label="Reproducir"]').exists()).toBe(true);
    await wrapper.get('button[aria-label="Reproducir"]').trigger('click');
    expect(play).toHaveBeenCalledTimes(1);
    await fire('play');
    expect(wrapper.find('button[aria-label="Pausar"]').exists()).toBe(true);
  });

  it('un error mientras suena cae a la tarjeta y quita el elemento de medio', async () => {
    mountPlayer();
    control({ paused: false, error: { code: 3 } });
    await fire('play');
    await fire('error');
    expect(wrapper.find('article').exists()).toBe(true);
    expect(wrapper.find('audio, video').exists()).toBe(false);
  });
});

describe('MediaPlayer: accesibilidad', () => {
  it('el reproductor es un grupo enfocable que nombra el archivo y sus atajos', () => {
    mountPlayer();
    const group = wrapper.get('[role="group"][tabindex="0"]');
    const label = group.attributes('aria-label') ?? '';
    expect(label).toContain('sonido.mp3');
    expect(label).toContain('Espacio');
    expect(label).toContain('M silencia');
    expect(label).not.toContain('pantalla completa');
  });

  it('en vídeo el nombre accesible incluye la pantalla completa', () => {
    mountPlayer(VIDEO, 'wc\\clip.mp4');
    expect(
      wrapper.get('[role="group"][tabindex="0"]').attributes('aria-label'),
    ).toContain('F pantalla completa');
  });

  it('todos los controles tienen nombre accesible', () => {
    mountPlayer(VIDEO, 'wc\\clip.mp4');
    const names = wrapper
      .findAll('button')
      .map((button) => button.attributes('aria-label') ?? button.text());
    expect(names).toEqual(['Pantalla completa', 'Reproducir', 'Silenciar']);
    const sliders = wrapper
      .findAll('input')
      .map((input) => input.attributes('aria-label'));
    expect(sliders).toEqual(['Posición', 'Volumen']);
  });

  it('la región del visor se llama según el tipo', () => {
    mountPlayer();
    expect(wrapper.get('section').attributes('aria-label')).toBe(
      'Reproductor de audio',
    );
    wrapper.unmount();
    mountPlayer(VIDEO, 'wc\\clip.mp4');
    expect(wrapper.get('section').attributes('aria-label')).toBe(
      'Reproductor de vídeo',
    );
  });
});
