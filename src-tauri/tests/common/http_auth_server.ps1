param(
    [Parameter(Mandatory = $true)][int]$Port,
    [Parameter(Mandatory = $true)][string]$User,
    [Parameter(Mandatory = $true)][string]$Password
)
$ErrorActionPreference = 'Stop'
$expected = 'Basic ' + [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("${User}:${Password}"))
$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add("http://127.0.0.1:$Port/")
$listener.Start()
while ($true) {
    $context = $listener.GetContext()
    if ($context.Request.Headers['Authorization'] -eq $expected) {
        $context.Response.StatusCode = 404
    } else {
        $context.Response.StatusCode = 401
        $context.Response.AddHeader('WWW-Authenticate', 'Basic realm="dakedaduck-test"')
    }
    $context.Response.Close()
}
