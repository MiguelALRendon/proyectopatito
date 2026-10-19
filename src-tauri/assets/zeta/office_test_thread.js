'use strict';

function firstSheet() {
  return model.getSheets().getByIndex(0);
}

function insertText(kind, text) {
  if (kind === 'writer') {
    const body = model.getText();
    body.insertString(body.getEnd(), text, false);
  } else if (kind === 'calc') {
    firstSheet().getCellByPosition(1, 0).setString(text);
  } else if (kind === 'impress') {
    const pages = model.getDrawPages();
    pages.insertNewByIndex(pages.getCount());
    const slide = pages.getByIndex(pages.getCount() - 1);
    const shape = model.createInstance('com.sun.star.drawing.TextShape');
    slide.add(shape);
    shape.setString(text);
  }
}

function readText(kind) {
  if (kind === 'writer') return model.getText().getString();
  if (kind === 'calc') {
    const sheet = firstSheet();
    const cells = [0, 1].map((column) =>
      sheet.getCellByPosition(column, 0).getString(),
    );
    return cells.join('|');
  }
  const pages = model.getDrawPages();
  const parts = [];
  for (let index = 0; index < pages.getCount(); index += 1) {
    const slide = pages.getByIndex(index);
    for (let shape = 0; shape < slide.getCount(); shape += 1) {
      const item = slide.getByIndex(shape);
      if (item.getString) parts.push(item.getString());
    }
  }
  return parts.join('|');
}

Object.assign(handlers, {
  'test-insert'(message) {
    const kind = kindOf(model);
    insertText(kind, message.text);
    post({
      cmd: 'test-result',
      testId: message.testId,
      kind,
      modified: model.isModified(),
    });
  },
  'test-window-size'(message) {
    const frame = model.getCurrentController().getFrame();
    const size = frame.getContainerWindow().getPosSize();
    post({
      cmd: 'test-result',
      testId: message.testId,
      x: size.X,
      y: size.Y,
      width: size.Width,
      height: size.Height,
    });
  },
  'test-dispatch'(message) {
    const helper = css.frame.DispatchHelper.create(
      zetajs.getUnoComponentContext(),
    );
    const frame = model.getCurrentController().getFrame();
    helper.executeDispatch(frame, message.url, '', 0, []);
    post({ cmd: 'test-result', testId: message.testId, url: message.url });
  },
  'test-read'(message) {
    const kind = kindOf(model);
    post({
      cmd: 'test-result',
      testId: message.testId,
      kind,
      text: readText(kind),
    });
  },
});
