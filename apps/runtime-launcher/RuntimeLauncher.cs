using System;
using System.Diagnostics;
using System.IO;

// A fixed, argument-free bootstrap for the existing owner runtime. It cannot
// receive a command, script, project, URL or executable from UXP/MCP callers.
internal static class RuntimeLauncher
{
    private const string Repository = __REPOSITORY__;
    private const string Node = __NODE__;
    private const string Launcher = __LAUNCHER__;

    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Length != 0) return 64;
        try
        {
            var actual = Path.GetFullPath(Process.GetCurrentProcess().MainModule.FileName);
            if (!String.Equals(actual, Launcher, StringComparison.OrdinalIgnoreCase)) return 65;
            var entry = Path.Combine(Repository, "apps", "mcp-server", "dist", "runtime-cli.js");
            if (!File.Exists(Node) || !File.Exists(entry)) return 66;
            var info = new ProcessStartInfo(Node, "\"" + entry + "\" start") {
                WorkingDirectory = Repository,
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden,
                RedirectStandardOutput = true,
                RedirectStandardError = true
            };
            using (var child = Process.Start(info))
            {
                var output = child.StandardOutput.ReadToEndAsync();
                var error = child.StandardError.ReadToEndAsync();
                // Never kill a shared runtime when readiness is uncertain.
                if (!child.WaitForExit(30000)) return 75;
                File.WriteAllText(Path.Combine(Repository, "artifacts", "runtime", "uxp-startup.log"),
                    DateTime.UtcNow.ToString("o") + Environment.NewLine + output.Result + error.Result);
                return child.ExitCode;
            }
        }
        catch (Exception) { return 70; }
    }
}
