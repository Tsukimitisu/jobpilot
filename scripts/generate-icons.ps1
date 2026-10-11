Add-Type -AssemblyName System.Drawing
$root = Split-Path $PSScriptRoot -Parent
foreach ($entry in @(@{Size=192;Name='icon-192.png'}, @{Size=512;Name='icon-512.png'}, @{Size=180;Name='apple-touch-icon.png'})) {
  $size = $entry.Size
  $bitmap = New-Object System.Drawing.Bitmap($size, $size)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.Clear([System.Drawing.ColorTranslator]::FromHtml('#246344'))
  $graphics.ScaleTransform($size / 32.0, $size / 32.0)
  $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::White, 1.6)
  $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $path.AddLine(16, 24, 16, 15)
  $path.StartFigure()
  $path.AddBezier(16, 20, 9, 20, 8, 14, 8, 11)
  $path.AddBezier(8, 11, 14, 11, 16, 14, 16, 20)
  $path.StartFigure()
  $path.AddBezier(16, 16, 16, 10, 20, 8, 24, 8)
  $path.AddBezier(24, 8, 24, 13, 22, 16, 16, 16)
  $graphics.DrawPath($pen, $path)
  $bitmap.Save((Join-Path $root ('public/' + $entry.Name)), [System.Drawing.Imaging.ImageFormat]::Png)
  $path.Dispose(); $pen.Dispose(); $graphics.Dispose(); $bitmap.Dispose()
}
Write-Output 'Generated 192px, 512px, and 180px PNG installation icons.'
