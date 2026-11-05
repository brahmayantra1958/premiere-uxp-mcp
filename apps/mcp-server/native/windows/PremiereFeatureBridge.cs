using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

namespace PremiereUxpMcp.NativeBridge
{
    internal sealed class BridgeRequest
    {
        public int protocolVersion { get; set; }
        public string operation { get; set; }
        public int premierePid { get; set; }
        public string mediaType { get; set; }
        public int expectedTrackCount { get; set; }
        public string[] expectedTrackNames { get; set; }
        public int timeoutMs { get; set; }
    }

    internal sealed class WindowRecord
    {
        public IntPtr Handle;
        public string ClassName;
        public string Title;
        public bool Visible;
        public bool Enabled;
    }

    internal static class Program
    {
        private const int ProtocolVersion = 1;
        private const uint WmCommand = 0x0111;
        private const uint WmClose = 0x0010;
        private const uint WmKeyDown = 0x0100;
        private const uint WmKeyUp = 0x0101;
        private const uint SmtoAbortIfHung = 0x0002;
        private const uint MfByPosition = 0x0400;
        private const uint TrackDeleteCommandId = 11630;
        private const int VkTab = 0x09;
        private const int VkReturn = 0x0D;
        private const int VkSpace = 0x20;

        private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

        [DllImport("user32.dll")]
        private static extern IntPtr GetMenu(IntPtr hWnd);

        [DllImport("user32.dll")]
        private static extern int GetMenuItemCount(IntPtr hMenu);

        [DllImport("user32.dll")]
        private static extern IntPtr GetSubMenu(IntPtr hMenu, int position);

        [DllImport("user32.dll")]
        private static extern uint GetMenuItemID(IntPtr hMenu, int position);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern int GetMenuString(IntPtr hMenu, uint item, StringBuilder text, int max, uint flags);

        [DllImport("user32.dll")]
        private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);

        [DllImport("user32.dll")]
        private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int max);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern int GetClassName(IntPtr hWnd, StringBuilder text, int max);

        [DllImport("user32.dll")]
        private static extern bool IsWindowVisible(IntPtr hWnd);

        [DllImport("user32.dll")]
        private static extern bool IsWindowEnabled(IntPtr hWnd);

        [DllImport("user32.dll", SetLastError = true)]
        private static extern IntPtr SendMessageTimeout(
            IntPtr hWnd,
            uint message,
            IntPtr wParam,
            IntPtr lParam,
            uint flags,
            uint timeout,
            out IntPtr result);

        private static readonly JavaScriptSerializer Json = new JavaScriptSerializer();

        public static int Main(string[] args)
        {
            try
            {
                Console.OutputEncoding = new UTF8Encoding(false);
                if (args.Length != 2 || args[0] != "--request-base64")
                    throw new InvalidOperationException("INVALID_INVOCATION: expected --request-base64 and one encoded request");
                var json = Encoding.UTF8.GetString(Convert.FromBase64String(args[1]));
                var request = Json.Deserialize<BridgeRequest>(json);
                if (request == null) throw new InvalidOperationException("INVALID_REQUEST: request body is empty");
                var response = Dispatch(request);
                Console.Out.Write(Json.Serialize(response));
                return 0;
            }
            catch (Exception error)
            {
                Console.Out.Write(Json.Serialize(new
                {
                    status = "fail",
                    route = "premiere_win32_allowlisted_feature_bridge",
                    errors = new[] { error.Message }
                }));
                return 1;
            }
        }

        private static object Dispatch(BridgeRequest request)
        {
            if (request.protocolVersion != ProtocolVersion)
                throw new InvalidOperationException("PROTOCOL_VERSION_MISMATCH");
            if (request.premierePid <= 0) throw new InvalidOperationException("INVALID_PREMIERE_PID");
            var process = Process.GetProcessById(request.premierePid);
            if (!String.Equals(process.ProcessName, "Adobe Premiere Pro", StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("PREMIERE_PROCESS_MISMATCH");
            var executablePath = process.MainModule == null ? "" : process.MainModule.FileName;
            if (!executablePath.EndsWith("Adobe Premiere Pro.exe", StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("PREMIERE_EXECUTABLE_MISMATCH");
            var version = FileVersionInfo.GetVersionInfo(executablePath);
            if (version.FileMajorPart != 26 || version.FileMinorPart != 3)
                throw new InvalidOperationException("PREMIERE_VERSION_UNVERIFIED");

            var commandWindow = FindPremiereCommandWindow((uint)process.Id, process.MainWindowHandle);
            if (commandWindow == IntPtr.Zero) throw new InvalidOperationException("PREMIERE_COMMAND_WINDOW_MISSING");
            var deletePath = FindMenuPath(commandWindow, TrackDeleteCommandId);
            if (deletePath == null) throw new InvalidOperationException("DELETE_TRACKS_COMMAND_NOT_FOUND");

            if (request.operation == "probe")
                return Success(request, version.FileVersion, deletePath, "available");
            if (request.operation == "delete_empty_tracks")
                return DeleteEmptyTracks(process, commandWindow, request, version.FileVersion, deletePath);
            if (request.operation == "cancel_delete_tracks_dialog")
                return CancelDeleteTracksDialog(process, request, version.FileVersion, deletePath);
            throw new InvalidOperationException("OPERATION_NOT_ALLOWLISTED");
        }

        private static object DeleteEmptyTracks(Process process, IntPtr commandWindow, BridgeRequest request, string version, string deletePath)
        {
            if (request.mediaType != "video" && request.mediaType != "audio" && request.mediaType != "caption")
                throw new InvalidOperationException("INVALID_MEDIA_TYPE");
            if (request.expectedTrackCount <= 0 || request.expectedTrackCount > 64)
                throw new InvalidOperationException("INVALID_EXPECTED_TRACK_COUNT");
            if (request.expectedTrackNames == null || request.expectedTrackNames.Length != request.expectedTrackCount)
                throw new InvalidOperationException("EXPECTED_TRACK_NAMES_MISMATCH");
            var uniqueTrackNames = new HashSet<string>(StringComparer.Ordinal);
            foreach (var trackName in request.expectedTrackNames)
            {
                if (String.IsNullOrWhiteSpace(trackName) || !uniqueTrackNames.Add(trackName))
                    throw new InvalidOperationException("INVALID_EXPECTED_TRACK_NAMES");
            }
            var timeout = NormalizeTimeout(request.timeoutMs);
            var existingDialogs = FindModalDialogs((uint)process.Id);
            if (existingDialogs.Count != 0) throw new InvalidOperationException("PREMIERE_MODAL_DIALOG_ALREADY_OPEN");

            SendRequired(commandWindow, WmCommand, new IntPtr(TrackDeleteCommandId), IntPtr.Zero, timeout, "OPEN_DELETE_TRACKS_DIALOG_FAILED");
            var dialog = WaitForDialog((uint)process.Id, timeout);
            if (dialog == IntPtr.Zero) throw new InvalidOperationException("DELETE_TRACKS_DIALOG_NOT_OBSERVED");
            var dialogTitle = ReadWindowText(dialog);
            if (!String.Equals(dialogTitle, "트랙 삭제", StringComparison.OrdinalIgnoreCase)
                && !String.Equals(dialogTitle, "Delete Tracks", StringComparison.OrdinalIgnoreCase))
            {
                SendBestEffort(dialog, WmClose, IntPtr.Zero, IntPtr.Zero, 1000);
                throw new InvalidOperationException("UNEXPECTED_PREMIERE_MODAL_DIALOG:" + dialogTitle);
            }

            try
            {
                var tabsToCheckbox = request.mediaType == "video" ? 2 : request.mediaType == "audio" ? 4 : 6;
                for (var tab = 0; tab < tabsToCheckbox; tab++) Tap(dialog, VkTab, timeout);
                Tap(dialog, VkSpace, timeout);
                Tap(dialog, VkTab, timeout);
                // The newly opened Premiere dialog defaults this combo box to
                // "All empty tracks". Do not enter the index-based list: the
                // caller has already proven that its requested identities are
                // exactly the complete empty-track set for this media type.
                var tabsToConfirm = request.mediaType == "video" ? 5 : request.mediaType == "audio" ? 3 : 1;
                for (var tab = 0; tab < tabsToConfirm; tab++) Tap(dialog, VkTab, timeout);
                Tap(dialog, VkReturn, timeout);
                if (!WaitForDialogClosed(dialog, timeout))
                    throw new InvalidOperationException("DELETE_TRACKS_DIALOG_DID_NOT_CLOSE");
            }
            catch
            {
                SendBestEffort(dialog, WmClose, IntPtr.Zero, IntPtr.Zero, 1000);
                throw;
            }

            return Success(request, version, deletePath, "accepted_unverified");
        }

        private static object CancelDeleteTracksDialog(Process process, BridgeRequest request, string version, string deletePath)
        {
            var timeout = NormalizeTimeout(request.timeoutMs);
            var dialogs = FindModalDialogs((uint)process.Id);
            if (dialogs.Count == 0) throw new InvalidOperationException("DELETE_TRACKS_DIALOG_NOT_OPEN");
            if (dialogs.Count != 1) throw new InvalidOperationException("AMBIGUOUS_PREMIERE_MODAL_DIALOG");
            var dialog = dialogs[0];
            if (!String.Equals(dialog.Title, "트랙 삭제", StringComparison.OrdinalIgnoreCase)
                && !String.Equals(dialog.Title, "Delete Tracks", StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("UNEXPECTED_PREMIERE_MODAL_DIALOG:" + dialog.Title);
            SendRequired(dialog.Handle, WmClose, IntPtr.Zero, IntPtr.Zero, timeout, "CANCEL_DELETE_TRACKS_DIALOG_FAILED");
            if (!WaitForDialogClosed(dialog.Handle, timeout))
                throw new InvalidOperationException("DELETE_TRACKS_DIALOG_DID_NOT_CLOSE");
            return Success(request, version, deletePath, "accepted_unverified");
        }

        private static Dictionary<string, object> Success(BridgeRequest request, string version, string deletePath, string dispatchState)
        {
            var response = new Dictionary<string, object>
            {
                { "status", "pass" },
                { "route", "premiere_win32_allowlisted_feature_bridge" },
                { "protocolVersion", ProtocolVersion },
                { "operation", request.operation },
                { "premierePid", request.premierePid },
                { "premiereVersion", version },
                { "mediaType", request.mediaType },
                { "expectedTrackCount", request.expectedTrackCount },
                { "expectedTrackNames", request.expectedTrackNames },
                { "command", new Dictionary<string, object>
                    {
                        { "deleteTracks", TrackDeleteCommandId },
                        { "deletePath", deletePath }
                    }
                },
                { "dispatchState", dispatchState },
                { "errors", new string[0] }
            };
            return response;
        }

        private static uint NormalizeTimeout(int timeoutMs)
        {
            if (timeoutMs <= 0) return 5000;
            if (timeoutMs < 500 || timeoutMs > 15000) throw new InvalidOperationException("INVALID_TIMEOUT");
            return (uint)timeoutMs;
        }

        private static void Tap(IntPtr window, int virtualKey, uint timeout)
        {
            SendRequired(window, WmKeyDown, new IntPtr(virtualKey), IntPtr.Zero, timeout, "KEY_DOWN_FAILED");
            SendRequired(window, WmKeyUp, new IntPtr(virtualKey), IntPtr.Zero, timeout, "KEY_UP_FAILED");
            Thread.Sleep(15);
        }

        private static void SendRequired(IntPtr window, uint message, IntPtr wParam, IntPtr lParam, uint timeout, string error)
        {
            IntPtr result;
            if (SendMessageTimeout(window, message, wParam, lParam, SmtoAbortIfHung, timeout, out result) == IntPtr.Zero)
                throw new InvalidOperationException(error + ": " + Marshal.GetLastWin32Error());
        }

        private static void SendBestEffort(IntPtr window, uint message, IntPtr wParam, IntPtr lParam, uint timeout)
        {
            IntPtr result;
            SendMessageTimeout(window, message, wParam, lParam, SmtoAbortIfHung, timeout, out result);
        }

        private static IntPtr WaitForDialog(uint processId, uint timeout)
        {
            var deadline = DateTime.UtcNow.AddMilliseconds(timeout);
            while (DateTime.UtcNow < deadline)
            {
                var dialogs = FindModalDialogs(processId);
                if (dialogs.Count == 1) return dialogs[0].Handle;
                if (dialogs.Count > 1) throw new InvalidOperationException("AMBIGUOUS_PREMIERE_MODAL_DIALOG");
                Thread.Sleep(25);
            }
            return IntPtr.Zero;
        }

        private static bool WaitForDialogClosed(IntPtr dialog, uint timeout)
        {
            var deadline = DateTime.UtcNow.AddMilliseconds(timeout);
            while (DateTime.UtcNow < deadline)
            {
                var found = false;
                EnumWindows(delegate(IntPtr window, IntPtr ignored)
                {
                    if (window == dialog) found = true;
                    return true;
                }, IntPtr.Zero);
                if (!found) return true;
                Thread.Sleep(25);
            }
            return false;
        }

        private static List<WindowRecord> FindModalDialogs(uint processId)
        {
            var dialogs = new List<WindowRecord>();
            EnumWindows(delegate(IntPtr window, IntPtr ignored)
            {
                uint owner;
                GetWindowThreadProcessId(window, out owner);
                if (owner != processId || !IsWindowVisible(window) || !IsWindowEnabled(window)) return true;
                var className = ReadClassName(window);
                if (className != "#32770") return true;
                dialogs.Add(new WindowRecord
                {
                    Handle = window,
                    ClassName = className,
                    Title = ReadWindowText(window),
                    Visible = true,
                    Enabled = true
                });
                return true;
            }, IntPtr.Zero);
            return dialogs;
        }

        private static IntPtr FindPremiereCommandWindow(uint processId, IntPtr reportedMainWindow)
        {
            if (reportedMainWindow != IntPtr.Zero
                && FindMenuPath(reportedMainWindow, TrackDeleteCommandId) != null)
                return reportedMainWindow;

            var result = IntPtr.Zero;
            EnumWindows(delegate(IntPtr window, IntPtr ignored)
            {
                uint owner;
                GetWindowThreadProcessId(window, out owner);
                if (owner != processId || !IsWindowVisible(window)) return true;
                if (ReadClassName(window) == "#32770") return true;
                if (FindMenuPath(window, TrackDeleteCommandId) == null) return true;
                result = window;
                return false;
            }, IntPtr.Zero);
            return result;
        }

        private static string FindMenuPath(IntPtr mainWindow, uint commandId)
        {
            var menu = GetMenu(mainWindow);
            if (menu == IntPtr.Zero) return null;
            return FindMenuPathRecursive(menu, commandId, "", 0);
        }

        private static string FindMenuPathRecursive(IntPtr menu, uint commandId, string parent, int depth)
        {
            if (depth > 8) return null;
            var count = GetMenuItemCount(menu);
            for (var position = 0; position < count; position++)
            {
                var label = ReadMenuLabel(menu, position);
                var current = String.IsNullOrEmpty(parent) ? label : parent + " > " + label;
                if (GetMenuItemID(menu, position) == commandId) return current;
                var submenu = GetSubMenu(menu, position);
                if (submenu == IntPtr.Zero) continue;
                var found = FindMenuPathRecursive(submenu, commandId, current, depth + 1);
                if (found != null) return found;
            }
            return null;
        }

        private static string ReadMenuLabel(IntPtr menu, int position)
        {
            var value = new StringBuilder(1024);
            GetMenuString(menu, (uint)position, value, value.Capacity, MfByPosition);
            return value.ToString();
        }

        private static string ReadWindowText(IntPtr window)
        {
            var value = new StringBuilder(1024);
            GetWindowText(window, value, value.Capacity);
            return value.ToString();
        }

        private static string ReadClassName(IntPtr window)
        {
            var value = new StringBuilder(512);
            GetClassName(window, value, value.Capacity);
            return value.ToString();
        }
    }
}
