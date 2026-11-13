class Asteria < Formula
  desc "NASA SPHEREx Sky Survey Time-Domain Research Tool"
  homepage "https://example.com/asteria"
  # URL needs to be updated to the actual repository/tarball source.
  url "https://example.com/asteria-1.0.0.tar.gz"
  sha256 "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" # Placeholder

  def install
    # Install all files into libexec
    libexec.install Dir["*"]

    # Create the wrapper script that runs launch.sh
    (bin/"ASTERIA").write <<~EOS
      #!/bin/bash
      #{libexec}/launch.sh "$@"
    EOS
  end

  # Optional: Add a test to ensure it works
  test do
    system "#{bin}/ASTERIA", "--version"
  end
end
