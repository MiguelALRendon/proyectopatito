param([Parameter(Mandatory = $true)][int]$Port)
$ErrorActionPreference = 'Stop'
$rsa = [System.Security.Cryptography.RSA]::Create(2048)
$request = [System.Security.Cryptography.X509Certificates.CertificateRequest]::new(
    'CN=127.0.0.1', $rsa,
    [System.Security.Cryptography.HashAlgorithmName]::SHA256,
    [System.Security.Cryptography.RSASignaturePadding]::Pkcs1)
$selfSigned = $request.CreateSelfSigned([DateTimeOffset]::UtcNow.AddDays(-1), [DateTimeOffset]::UtcNow.AddDays(1))
$certificate = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($selfSigned.Export('Pfx'))
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
$listener.Start()
while ($true) {
    $client = $listener.AcceptTcpClient()
    try {
        $tls = [System.Net.Security.SslStream]::new($client.GetStream(), $false)
        $tls.AuthenticateAsServer($certificate)
    } catch {
    } finally {
        $client.Close()
    }
}
