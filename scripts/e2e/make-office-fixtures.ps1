param(
    [Parameter(Mandatory)][string]$OutDir
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$xmlHeader = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
$odfNamespaces = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:presentation="urn:oasis:names:tc:opendocument:xmlns:presentation:1.0" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"'

function New-Zip([string]$Path, [array]$Entries) {
    if (Test-Path $Path) { Remove-Item $Path -Force }
    $stream = [IO.File]::Open($Path, [IO.FileMode]::CreateNew)
    try {
        $zip = [IO.Compression.ZipArchive]::new($stream, [IO.Compression.ZipArchiveMode]::Create)
        foreach ($entry in $Entries) {
            $level = if ($entry.Store) { [IO.Compression.CompressionLevel]::NoCompression } else { [IO.Compression.CompressionLevel]::Optimal }
            $item = $zip.CreateEntry($entry.Name, $level)
            $writer = [IO.StreamWriter]::new($item.Open(), [Text.UTF8Encoding]::new($false))
            $writer.Write($entry.Content)
            $writer.Dispose()
        }
        $zip.Dispose()
    } finally { $stream.Dispose() }
}

function Part([string]$Name, [string]$Content, [bool]$Store = $false) {
    @{ Name = $Name; Content = $Content; Store = $Store }
}

function New-Docx([string]$Path, [string]$Text = 'Hola DOCX') {
    New-Zip $Path @(
        (Part '[Content_Types].xml' "$xmlHeader<Types xmlns=`"http://schemas.openxmlformats.org/package/2006/content-types`"><Default Extension=`"rels`" ContentType=`"application/vnd.openxmlformats-package.relationships+xml`"/><Default Extension=`"xml`" ContentType=`"application/xml`"/><Override PartName=`"/word/document.xml`" ContentType=`"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml`"/></Types>")
        (Part '_rels/.rels' "$xmlHeader<Relationships xmlns=`"http://schemas.openxmlformats.org/package/2006/relationships`"><Relationship Id=`"rId1`" Type=`"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument`" Target=`"word/document.xml`"/></Relationships>")
        (Part 'word/document.xml' "$xmlHeader<w:document xmlns:w=`"http://schemas.openxmlformats.org/wordprocessingml/2006/main`"><w:body><w:p><w:r><w:t>$Text</w:t></w:r></w:p></w:body></w:document>")
    )
}

function New-Xlsx([string]$Path, [string]$Text = 'Hola XLSX') {
    New-Zip $Path @(
        (Part '[Content_Types].xml' "$xmlHeader<Types xmlns=`"http://schemas.openxmlformats.org/package/2006/content-types`"><Default Extension=`"rels`" ContentType=`"application/vnd.openxmlformats-package.relationships+xml`"/><Default Extension=`"xml`" ContentType=`"application/xml`"/><Override PartName=`"/xl/workbook.xml`" ContentType=`"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml`"/><Override PartName=`"/xl/worksheets/sheet1.xml`" ContentType=`"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml`"/></Types>")
        (Part '_rels/.rels' "$xmlHeader<Relationships xmlns=`"http://schemas.openxmlformats.org/package/2006/relationships`"><Relationship Id=`"rId1`" Type=`"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument`" Target=`"xl/workbook.xml`"/></Relationships>")
        (Part 'xl/workbook.xml' "$xmlHeader<workbook xmlns=`"http://schemas.openxmlformats.org/spreadsheetml/2006/main`" xmlns:r=`"http://schemas.openxmlformats.org/officeDocument/2006/relationships`"><sheets><sheet name=`"Hoja1`" sheetId=`"1`" r:id=`"rId1`"/></sheets></workbook>")
        (Part 'xl/_rels/workbook.xml.rels' "$xmlHeader<Relationships xmlns=`"http://schemas.openxmlformats.org/package/2006/relationships`"><Relationship Id=`"rId1`" Type=`"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet`" Target=`"worksheets/sheet1.xml`"/></Relationships>")
        (Part 'xl/worksheets/sheet1.xml' "$xmlHeader<worksheet xmlns=`"http://schemas.openxmlformats.org/spreadsheetml/2006/main`"><sheetData><row r=`"1`"><c r=`"A1`" t=`"inlineStr`"><is><t>$Text</t></is></c></row></sheetData></worksheet>")
    )
}

function New-Pptx([string]$Path, [string]$Text = 'Hola PPTX') {
    $ns = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"'
    $rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
    $shapeTree = '<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>{0}</p:spTree></p:cSld>'
    $textShape = "<p:sp><p:nvSpPr><p:cNvPr id=`"2`" name=`"Titulo`"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x=`"914400`" y=`"914400`"/><a:ext cx=`"7315200`" cy=`"914400`"/></a:xfrm><a:prstGeom prst=`"rect`"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>$Text</a:t></a:r></a:p></p:txBody></p:sp>"
    $theme = "$xmlHeader<a:theme xmlns:a=`"http://schemas.openxmlformats.org/drawingml/2006/main`" name=`"Tema`"><a:themeElements><a:clrScheme name=`"C`"><a:dk1><a:sysClr val=`"windowText`" lastClr=`"000000`"/></a:dk1><a:lt1><a:sysClr val=`"window`" lastClr=`"FFFFFF`"/></a:lt1><a:dk2><a:srgbClr val=`"1F497D`"/></a:dk2><a:lt2><a:srgbClr val=`"EEECE1`"/></a:lt2><a:accent1><a:srgbClr val=`"4F81BD`"/></a:accent1><a:accent2><a:srgbClr val=`"C0504D`"/></a:accent2><a:accent3><a:srgbClr val=`"9BBB59`"/></a:accent3><a:accent4><a:srgbClr val=`"8064A2`"/></a:accent4><a:accent5><a:srgbClr val=`"4BACC6`"/></a:accent5><a:accent6><a:srgbClr val=`"F79646`"/></a:accent6><a:hlink><a:srgbClr val=`"0000FF`"/></a:hlink><a:folHlink><a:srgbClr val=`"800080`"/></a:folHlink></a:clrScheme><a:fontScheme name=`"F`"><a:majorFont><a:latin typeface=`"Calibri`"/><a:ea typeface=`"`"/><a:cs typeface=`"`"/></a:majorFont><a:minorFont><a:latin typeface=`"Calibri`"/><a:ea typeface=`"`"/><a:cs typeface=`"`"/></a:minorFont></a:fontScheme><a:fmtScheme name=`"M`"><a:fillStyleLst><a:solidFill><a:schemeClr val=`"phClr`"/></a:solidFill><a:solidFill><a:schemeClr val=`"phClr`"/></a:solidFill><a:solidFill><a:schemeClr val=`"phClr`"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w=`"9525`"><a:solidFill><a:schemeClr val=`"phClr`"/></a:solidFill></a:ln><a:ln w=`"25400`"><a:solidFill><a:schemeClr val=`"phClr`"/></a:solidFill></a:ln><a:ln w=`"38100`"><a:solidFill><a:schemeClr val=`"phClr`"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val=`"phClr`"/></a:solidFill><a:solidFill><a:schemeClr val=`"phClr`"/></a:solidFill><a:solidFill><a:schemeClr val=`"phClr`"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>"
    New-Zip $Path @(
        (Part '[Content_Types].xml' "$xmlHeader<Types xmlns=`"http://schemas.openxmlformats.org/package/2006/content-types`"><Default Extension=`"rels`" ContentType=`"application/vnd.openxmlformats-package.relationships+xml`"/><Default Extension=`"xml`" ContentType=`"application/xml`"/><Override PartName=`"/ppt/presentation.xml`" ContentType=`"application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml`"/><Override PartName=`"/ppt/slideMasters/slideMaster1.xml`" ContentType=`"application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml`"/><Override PartName=`"/ppt/slideLayouts/slideLayout1.xml`" ContentType=`"application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml`"/><Override PartName=`"/ppt/slides/slide1.xml`" ContentType=`"application/vnd.openxmlformats-officedocument.presentationml.slide+xml`"/><Override PartName=`"/ppt/theme/theme1.xml`" ContentType=`"application/vnd.openxmlformats-officedocument.theme+xml`"/></Types>")
        (Part '_rels/.rels' "$xmlHeader<Relationships xmlns=`"http://schemas.openxmlformats.org/package/2006/relationships`"><Relationship Id=`"rId1`" Type=`"$rel/officeDocument`" Target=`"ppt/presentation.xml`"/></Relationships>")
        (Part 'ppt/presentation.xml' "$xmlHeader<p:presentation $ns><p:sldMasterIdLst><p:sldMasterId id=`"2147483648`" r:id=`"rId1`"/></p:sldMasterIdLst><p:sldIdLst><p:sldId id=`"256`" r:id=`"rId2`"/></p:sldIdLst><p:sldSz cx=`"9144000`" cy=`"6858000`"/><p:notesSz cx=`"6858000`" cy=`"9144000`"/></p:presentation>")
        (Part 'ppt/_rels/presentation.xml.rels' "$xmlHeader<Relationships xmlns=`"http://schemas.openxmlformats.org/package/2006/relationships`"><Relationship Id=`"rId1`" Type=`"$rel/slideMaster`" Target=`"slideMasters/slideMaster1.xml`"/><Relationship Id=`"rId2`" Type=`"$rel/slide`" Target=`"slides/slide1.xml`"/><Relationship Id=`"rId3`" Type=`"$rel/theme`" Target=`"theme/theme1.xml`"/></Relationships>")
        (Part 'ppt/slideMasters/slideMaster1.xml' ("$xmlHeader<p:sldMaster $ns>" + ($shapeTree -f '') + "<p:clrMap bg1=`"lt1`" tx1=`"dk1`" bg2=`"lt2`" tx2=`"dk2`" accent1=`"accent1`" accent2=`"accent2`" accent3=`"accent3`" accent4=`"accent4`" accent5=`"accent5`" accent6=`"accent6`" hlink=`"hlink`" folHlink=`"folHlink`"/><p:sldLayoutIdLst><p:sldLayoutId id=`"2147483649`" r:id=`"rId1`"/></p:sldLayoutIdLst></p:sldMaster>"))
        (Part 'ppt/slideMasters/_rels/slideMaster1.xml.rels' "$xmlHeader<Relationships xmlns=`"http://schemas.openxmlformats.org/package/2006/relationships`"><Relationship Id=`"rId1`" Type=`"$rel/slideLayout`" Target=`"../slideLayouts/slideLayout1.xml`"/><Relationship Id=`"rId2`" Type=`"$rel/theme`" Target=`"../theme/theme1.xml`"/></Relationships>")
        (Part 'ppt/slideLayouts/slideLayout1.xml' ("$xmlHeader<p:sldLayout $ns type=`"blank`">" + ($shapeTree -f '') + '</p:sldLayout>'))
        (Part 'ppt/slideLayouts/_rels/slideLayout1.xml.rels' "$xmlHeader<Relationships xmlns=`"http://schemas.openxmlformats.org/package/2006/relationships`"><Relationship Id=`"rId1`" Type=`"$rel/slideMaster`" Target=`"../slideMasters/slideMaster1.xml`"/></Relationships>")
        (Part 'ppt/slides/slide1.xml' ("$xmlHeader<p:sld $ns>" + ($shapeTree -f $textShape) + '</p:sld>'))
        (Part 'ppt/slides/_rels/slide1.xml.rels' "$xmlHeader<Relationships xmlns=`"http://schemas.openxmlformats.org/package/2006/relationships`"><Relationship Id=`"rId1`" Type=`"$rel/slideLayout`" Target=`"../slideLayouts/slideLayout1.xml`"/></Relationships>")
        (Part 'ppt/theme/theme1.xml' $theme)
    )
}

function New-Odf([string]$Path, [string]$Mime, [string]$Body) {
    $manifest = "$xmlHeader<manifest:manifest xmlns:manifest=`"urn:oasis:names:tc:opendocument:xmlns:manifest:1.0`" manifest:version=`"1.2`"><manifest:file-entry manifest:full-path=`"/`" manifest:media-type=`"$Mime`"/><manifest:file-entry manifest:full-path=`"content.xml`" manifest:media-type=`"text/xml`"/></manifest:manifest>"
    $content = "$xmlHeader<office:document-content $odfNamespaces office:version=`"1.2`">$Body</office:document-content>"
    New-Zip $Path @(
        (Part 'mimetype' $Mime $true)
        (Part 'META-INF/manifest.xml' $manifest)
        (Part 'content.xml' $content)
    )
}

function New-Odt([string]$Path, [string]$Text = 'Hola ODT') {
    New-Odf $Path 'application/vnd.oasis.opendocument.text' "<office:body><office:text><text:p>$Text</text:p></office:text></office:body>"
}

function New-Ods([string]$Path, [string]$Text = 'Hola ODS') {
    New-Odf $Path 'application/vnd.oasis.opendocument.spreadsheet' "<office:body><office:spreadsheet><table:table table:name=`"Hoja1`"><table:table-row><table:table-cell office:value-type=`"string`"><text:p>$Text</text:p></table:table-cell></table:table-row></table:table></office:spreadsheet></office:body>"
}

function New-Odp([string]$Path, [string]$Text = 'Hola ODP') {
    New-Odf $Path 'application/vnd.oasis.opendocument.presentation' "<office:body><office:presentation><draw:page draw:name=`"Diapositiva1`"><draw:frame svg:width=`"20cm`" svg:height=`"3cm`" svg:x=`"2cm`" svg:y=`"2cm`"><draw:text-box><text:p>$Text</text:p></draw:text-box></draw:frame></draw:page></office:presentation></office:body>"
}

function Set-ZipEntry([string]$Path, [string]$Name, [string]$Content) {
    $zip = [IO.Compression.ZipFile]::Open($Path, [IO.Compression.ZipArchiveMode]::Update)
    try {
        $existing = $zip.GetEntry($Name)
        if ($existing) { $existing.Delete() }
        $entry = $zip.CreateEntry($Name)
        $writer = [IO.StreamWriter]::new($entry.Open(), [Text.UTF8Encoding]::new($false))
        $writer.Write($Content)
        $writer.Dispose()
    } finally { $zip.Dispose() }
}

function New-MacroDocx([string]$Path) {
    New-Docx $Path 'Docx con macro VBA'
    Set-ZipEntry $Path 'word/vbaProject.bin' 'no es una macro de verdad: solo la presencia del almacen'
}

function New-MacroOdt([string]$Path) {
    $mime = 'application/vnd.oasis.opendocument.text'
    $libNs = 'xmlns:library="http://openoffice.org/2000/library"'
    $entries = @(
        @('Basic/script-lc.xml', 'text/xml'),
        @('Basic/Standard/script-lb.xml', 'text/xml'),
        @('Basic/Standard/Module1.xml', 'text/xml')
    ) | ForEach-Object { "<manifest:file-entry manifest:full-path=`"$($_[0])`" manifest:media-type=`"$($_[1])`"/>" }
    New-Odt $Path 'Odt con macro Basic'
    Set-ZipEntry $Path 'META-INF/manifest.xml' "$xmlHeader<manifest:manifest xmlns:manifest=`"urn:oasis:names:tc:opendocument:xmlns:manifest:1.0`" manifest:version=`"1.2`"><manifest:file-entry manifest:full-path=`"/`" manifest:media-type=`"$mime`"/><manifest:file-entry manifest:full-path=`"content.xml`" manifest:media-type=`"text/xml`"/>$($entries -join '')</manifest:manifest>"
    Set-ZipEntry $Path 'Basic/script-lc.xml' "$xmlHeader<library:libraries $libNs xmlns:xlink=`"http://www.w3.org/1999/xlink`"><library:library library:name=`"Standard`" library:link=`"false`"/></library:libraries>"
    Set-ZipEntry $Path 'Basic/Standard/script-lb.xml' "$xmlHeader<library:library $libNs library:name=`"Standard`" library:readonly=`"false`" library:passwordprotected=`"false`"><library:element library:name=`"Module1`"/></library:library>"
    Set-ZipEntry $Path 'Basic/Standard/Module1.xml' "$xmlHeader<script:module xmlns:script=`"http://openoffice.org/2000/script`" script:name=`"Module1`" script:language=`"StarBasic`">Sub Main`n End Sub</script:module>"
}

function New-LinkedDocx([string]$Path) {
    $rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
    New-Docx $Path 'Docx con vinculos remotos'
    Set-ZipEntry $Path 'word/document.xml' "$xmlHeader<w:document xmlns:w=`"http://schemas.openxmlformats.org/wordprocessingml/2006/main`" xmlns:r=`"$rel`"><w:body><w:p><w:hyperlink r:id=`"rId1`"><w:r><w:rPr><w:rStyle w:val=`"Hyperlink`"/></w:rPr><w:t>Enlace externo</w:t></w:r></w:hyperlink></w:p></w:body></w:document>"
    Set-ZipEntry $Path 'word/_rels/document.xml.rels' "$xmlHeader<Relationships xmlns=`"http://schemas.openxmlformats.org/package/2006/relationships`"><Relationship Id=`"rId1`" Type=`"$rel/hyperlink`" Target=`"https://example.invalid/enlace`" TargetMode=`"External`"/><Relationship Id=`"rId2`" Type=`"$rel/settings`" Target=`"settings.xml`"/><Relationship Id=`"rId3`" Type=`"$rel/styles`" Target=`"styles.xml`"/></Relationships>"
    Set-ZipEntry $Path 'word/styles.xml' "$xmlHeader<w:styles xmlns:w=`"http://schemas.openxmlformats.org/wordprocessingml/2006/main`"><w:style w:type=`"character`" w:styleId=`"Hyperlink`"><w:name w:val=`"Hyperlink`"/><w:rPr><w:color w:val=`"0000FF`"/><w:u w:val=`"single`"/></w:rPr></w:style></w:styles>"
    Set-ZipEntry $Path 'word/settings.xml' "$xmlHeader<w:settings xmlns:w=`"http://schemas.openxmlformats.org/wordprocessingml/2006/main`" xmlns:r=`"$rel`"><w:attachedTemplate r:id=`"rId1`"/></w:settings>"
    Set-ZipEntry $Path 'word/_rels/settings.xml.rels' "$xmlHeader<Relationships xmlns=`"http://schemas.openxmlformats.org/package/2006/relationships`"><Relationship Id=`"rId1`" Type=`"$rel/attachedTemplate`" Target=`"https://example.invalid/plantilla.dotm`" TargetMode=`"External`"/></Relationships>"
}

New-Item -ItemType Directory -Force $OutDir | Out-Null
New-Docx (Join-Path $OutDir 'documento.docx')
New-Xlsx (Join-Path $OutDir 'hoja.xlsx')
New-Pptx (Join-Path $OutDir 'presentacion.pptx')
New-Odt (Join-Path $OutDir 'documento.odt')
New-Ods (Join-Path $OutDir 'hoja.ods')
New-Odp (Join-Path $OutDir 'presentacion.odp')
New-MacroDocx (Join-Path $OutDir 'macro.docx')
New-MacroOdt (Join-Path $OutDir 'macro.odt')
New-LinkedDocx (Join-Path $OutDir 'enlaces.docx')
Get-ChildItem $OutDir -File | Select-Object -ExpandProperty FullName
