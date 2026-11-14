class Asteria < Formula
  desc "ASTERIA Research Tool Astronomical SPHEREx Time-series Extraction & Rapid Image Analysis"
  homepage "https://quantal-labs.com/asteria"
  url "https://github.com/Quantal-Universe/ASTERIA/archive/refs/tags/v2.0.0.tar.gz"
  sha256 "b2618ab6f7aa8956ba64d9fd1139ffa29ff5d5db3e822839970c54104dcb766f" 
  
  depends_on "node"
  depends_on "simdjson"
  
  def install
    # Install dependencies inside src/
    Dir.chdir("src") do
      system "npm", "install"
    end

    # Install all files into libexec
    libexec.install Dir["*"]

    # Create the wrapper script that runs launch.sh
    (bin/"ASTERIA").write <<~EOS
      #!/bin/bash
      #{libexec}/src/launch.sh "$@"
    EOS
  end

  # Optional: Add a test to ensure it works
  test do
    system "#{bin}/ASTERIA", "--version"
  end
end