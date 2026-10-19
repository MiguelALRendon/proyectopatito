'use strict';

const MACRO_MODE_NEVER_EXECUTE = 0;
const UPDATE_MODE_NO_UPDATE = 0;
const OFFICE_DIR = 'file:///tmp/office/';
const WINDOW_FLAGS_ALL = 15;
const SAVE_COMMAND = '.uno:Save';
const SERVICES = {
  writer: 'com.sun.star.text.TextDocument',
  calc: 'com.sun.star.sheet.SpreadsheetDocument',
  impress: 'com.sun.star.presentation.PresentationDocument',
};
const BLOCKED = [
  '.uno:Open',
  '.uno:OpenRemote',
  '.uno:RecentFileList',
  '.uno:SaveAs',
  '.uno:SaveAsRemote',
  '.uno:SaveAsTemplate',
  '.uno:SaveAll',
  '.uno:SaveACopy',
  '.uno:ExportTo',
  '.uno:ExportToPDF',
  '.uno:ExportDirectToPDF',
  '.uno:ExportToEPUB',
  '.uno:SendMail',
  '.uno:SendMailDocAsPDF',
  '.uno:SendMailDocAsOOo',
  '.uno:SendMailDocAsMS',
  '.uno:OpenHyperlink',
  '.uno:RunMacro',
  '.uno:MacroOrganizer',
  '.uno:ScriptOrganizer',
  '.uno:Print',
  '.uno:PrintDefault',
  '.uno:PrinterSetup',
  '.uno:NewDoc',
  '.uno:AddDirect',
  '.uno:AutoPilotMenu',
  '.uno:NewWindow',
  '.uno:CloseDoc',
  '.uno:CloseWin',
  '.uno:CloseFrame',
  '.uno:Quit',
  '.uno:Reload',
  '.uno:SelectTemplate',
  '.uno:NewFromTemplate',
  '.uno:StartCenter',
  '.uno:OptionsTreeDialog',
  '.uno:ConfigureDialog',
  '.uno:About',
  '.uno:HelpIndex',
  '.uno:ExtendedHelp',
  '.uno:OnlineUpdate',
  '.uno:HelpSupport',
  '.uno:ShowTipOfTheDay',
  '.uno:Feedback',
  '.uno:Donate',
  '.uno:WhatsNew',
  '.uno:Signature',
  '.uno:AddInfo',
  '.uno:InsertGraphic',
  '.uno:InsertSound',
  '.uno:InsertVideo',
  '.uno:InsertPlugin',
  '.uno:InsertObject',
  '.uno:InsertDoc',
  '.uno:InsertFile',
  '.uno:LinkDialog',
  '.uno:EditLinks',
  '.uno:UpdateAllLinks',
  '.uno:MacroRecorder',
  '.uno:BasicIDEAppear',
  '.uno:MacroSignature',
  '.uno:DevelopmentToolsDockingWindow',
  '.uno:OpenXMLFilterSettings',
  '.uno:MailMergeWizard',
  '.uno:BibliographyComponent',
  '.uno:AddressBookSource',
  '.uno:ViewDataSourceBrowser',
  '.uno:Translate',
  '.uno:MoreDictionaries',
  '.uno:ExternalEdit',
  '.uno:ChangePicture',
  '.uno:SaveGraphic',
  '.uno:Scan',
  '.uno:InsertAVMedia',
  '.uno:SignPDF',
  '.uno:CheckOut',
  '.uno:CancelCheckOut',
  '.uno:CheckIn',
  '.uno:VersionDialog',
  '.uno:WebHtml',
  '.uno:NewGlobalDoc',
  '.uno:NewHtmlDoc',
  '.uno:SendViaBluetooth',
  '.uno:SendOutlineToStarImpress',
  '.uno:SendOutlineToClipboard',
  '.uno:CreateAbstract',
  '.uno:SendAbstractToStarImpress',
  '.uno:SendFeedback',
  '.uno:SafeMode',
  '.uno:ShowLicense',
  '.uno:Documentation',
  '.uno:TipOfTheDay',
];
const BLOCKED_PREFIXES = [
  '.uno:Open',
  '.uno:SaveAs',
  '.uno:Export',
  '.uno:SendMail',
  'private:',
  'service:',
  'file:',
  'vnd.sun.star.script:',
  'macro:',
  'http:',
  'https:',
  'ftp:',
  'mailto:',
];

let zetajs;
let css;
let desktop;
let model = null;
let isStoring = false;
let saveRequest;
const blockedDispatches = new Map();

function post(message) {
  zetajs.mainPort.postMessage(message);
}

function describe(error) {
  return String((error && error.message) || error).slice(0, 200);
}

function properties(entries) {
  return Object.entries(entries).map(
    ([Name, Value]) => new css.beans.PropertyValue({ Name, Value }),
  );
}

function kindOf(document) {
  const kind = Object.keys(SERVICES).find((key) =>
    document.supportsService(SERVICES[key]),
  );
  return kind || 'unknown';
}

function blockedDispatch(command) {
  if (!blockedDispatches.has(command)) {
    blockedDispatches.set(
      command,
      zetajs.unoObject([css.frame.XDispatch], {
        dispatch: () => post({ cmd: 'blocked', command }),
        addStatusListener() {},
        removeStatusListener() {},
      }),
    );
  }
  return blockedDispatches.get(command);
}

function isBlocked(command) {
  return (
    BLOCKED.includes(command) ||
    BLOCKED_PREFIXES.some((prefix) => command.startsWith(prefix))
  );
}

function makeInterceptor() {
  let slave = null;
  let master = null;
  return zetajs.unoObject([css.frame.XDispatchProviderInterceptor], {
    getSlaveDispatchProvider: () => slave,
    setSlaveDispatchProvider(provider) {
      slave = provider;
    },
    getMasterDispatchProvider: () => master,
    setMasterDispatchProvider(provider) {
      master = provider;
    },
    queryDispatch(url, target, flags) {
      if (url.Complete === SAVE_COMMAND) return saveRequest;
      if (isBlocked(url.Complete)) return blockedDispatch(url.Complete);
      return slave ? slave.queryDispatch(url, target, flags) : null;
    },
    queryDispatches(requests) {
      return requests.map((request) =>
        this.queryDispatch(
          request.FeatureURL,
          request.FrameName,
          request.SearchFlags,
        ),
      );
    },
  });
}

function intercept(registrar) {
  registrar.registerDispatchProviderInterceptor(makeInterceptor());
}

function watchSaves(document) {
  document.addDocumentEventListener(
    zetajs.unoObject([css.document.XDocumentEventListener], {
      documentEventOccured(event) {
        const isStored = event.EventName === 'OnSaveDone';
        if (isStored && !isStoring) post({ cmd: 'stored', requested: false });
      },
      disposing() {},
    }),
  );
}

function watchChanges(document) {
  document.addModifyListener(
    zetajs.unoObject([css.util.XModifyListener], {
      modified() {
        if (!isStoring && document.isModified()) post({ cmd: 'modified' });
      },
      disposing() {},
    }),
  );
}

const handlers = {
  open(message) {
    model = desktop.loadComponentFromURL(
      OFFICE_DIR + message.name,
      '_default',
      0,
      properties({
        MacroExecutionMode: MACRO_MODE_NEVER_EXECUTE,
        UpdateDocMode: UPDATE_MODE_NO_UPDATE,
        ReadOnly: false,
      }),
    );
    if (!model) return post({ cmd: 'failed', detail: 'documento no cargado' });
    watchChanges(model);
    watchSaves(model);
    intercept(model.getCurrentController().getFrame());
    post({ cmd: 'opened', kind: kindOf(model) });
  },
  fit(message) {
    if (!model) return;
    const frame = model.getCurrentController().getFrame();
    frame
      .getContainerWindow()
      .setPosSize(0, 0, message.w, message.h, WINDOW_FLAGS_ALL);
  },
  save() {
    isStoring = true;
    try {
      model.store();
    } finally {
      isStoring = false;
    }
    post({ cmd: 'stored', requested: true });
  },
  close() {
    model.close(true);
    model = null;
    post({ cmd: 'closed' });
  },
};

function onMessage(event) {
  const handler = Object.hasOwn(handlers, event.data.cmd)
    ? handlers[event.data.cmd]
    : null;
  if (!handler) return;
  try {
    handler(event.data);
  } catch (error) {
    console.error('DIAG', describe(error));
    post({ cmd: 'failed', detail: describe(error) });
  }
}

Module.zetajs.then((loaded) => {
  zetajs = loaded;
  css = zetajs.uno.com.sun.star;
  desktop = css.frame.Desktop.create(zetajs.getUnoComponentContext());
  saveRequest = zetajs.unoObject([css.frame.XDispatch], {
    dispatch: () => post({ cmd: 'save-requested' }),
    addStatusListener() {},
    removeStatusListener() {},
  });
  intercept(desktop);
  zetajs.mainPort.onmessage = onMessage;
});
