# iOS build for the ChessEngine Nitro module.
#
# TEMPLATE — follows Nitro Modules' standard podspec layout. Run `npm run
# codegen` (nitro-codegen) first to produce nitrogen/generated/. Verify against
# the Nitro version you install (https://nitro.margelo.com). The ONE
# project-specific line is the HEADER_SEARCH_PATHS entry that puts the repo's
# header-only engine (../../core) on the include path so <game.hpp> resolves.

require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "ChessEngine"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = "https://github.com/ziggityzaggity/Chess"
  s.license      = "MIT"
  s.author       = "Ali Rashid"
  s.platforms    = { :ios => 13.4 }
  s.source       = { :git => "https://github.com/ziggityzaggity/Chess.git", :tag => s.version.to_s }

  # Our JSI binding (cpp/) + the nitrogen-generated glue.
  s.source_files = [
    "cpp/**/*.{hpp,cpp}",
    "nitrogen/generated/ios/**/*.{hpp,cpp,swift}",
    "nitrogen/generated/shared/**/*.{hpp,cpp}",
  ]

  s.pod_target_xcconfig = {
    "CLANG_CXX_LANGUAGE_STANDARD" => "c++17",
    # cpp/ for our binding; ../../core for the header-only engine (chess.hpp/game.hpp).
    "HEADER_SEARCH_PATHS" => "\"#{__dir__}/cpp\" \"#{__dir__}/../../core\"",
  }

  # Nitro autolinking: registers HybridChessEngine and pulls in generated files.
  load File.join(__dir__, "nitrogen", "generated", "ios", "ChessEngine+autolinking.rb")
  add_nitrogen_files(s)

  install_modules_dependencies(s)
end
