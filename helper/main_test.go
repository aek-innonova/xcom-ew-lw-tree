package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func game(t *testing.T) string {
	root := t.TempDir()
	g := filepath.Join(root, "XCom-Enemy-Unknown", "XEW", "XComGame")
	for _, d := range []string{"CookedPCConsole", "Config"} {
		if err := os.MkdirAll(filepath.Join(g, d), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(g, "Config", "DefaultGameCore.ini"), []byte("A=1\r\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	return g
}

func call(h http.Handler, method, target, origin, code, body string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, target, strings.NewReader(body))
	if origin != "" {
		r.Header.Set("Origin", origin)
	}
	if code != "" {
		r.Header.Set("X-Lwtree-Code", code)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

const site = "https://xcom.innonova.ch"

func TestFindsTheGameUnderAnyOfItsFolders(t *testing.T) {
	g := game(t)
	for _, p := range []string{g, filepath.Dir(g), filepath.Dir(filepath.Dir(g))} {
		if got, err := findGame(p, func(string) {}); err != nil || got != g {
			t.Errorf("findGame(%s) = %s, %v", p, got, err)
		}
	}
	if _, err := findGame(t.TempDir(), func(string) {}); err == nil {
		t.Error("an empty folder should not count as the game")
	}
}

func TestOnlyTheSiteWithTheCode(t *testing.T) {
	h := handler(game(t), "ABCD-EFGH")
	if w := call(h, "GET", "/v1/hello", "https://example.com", "", ""); w.Code != http.StatusForbidden {
		t.Errorf("another site: %d", w.Code)
	}
	if w := call(h, "GET", "/v1/hello", "", "", ""); w.Code != http.StatusForbidden {
		t.Errorf("no origin: %d", w.Code)
	}
	if w := call(h, "GET", "/v1/hello", site, "", ""); w.Code != http.StatusOK {
		t.Errorf("hello: %d", w.Code)
	}
	if w := call(h, "GET", "/v1/file?path=Config/DefaultGameCore.ini", site, "WRONG", ""); w.Code != http.StatusUnauthorized {
		t.Errorf("wrong code: %d", w.Code)
	}
	w := call(h, "GET", "/v1/file?path=config/defaultgamecore.ini", site, "ABCD-EFGH", "")
	if w.Code != http.StatusOK || w.Body.String() != "A=1\r\n" {
		t.Errorf("read (any case): %d %q", w.Code, w.Body.String())
	}
	pre := call(h, "OPTIONS", "/v1/file", site, "", "")
	if pre.Header().Get("Access-Control-Allow-Private-Network") != "true" || pre.Header().Get("Access-Control-Allow-Origin") != site {
		t.Errorf("preflight headers: %v", pre.Header())
	}
}

func TestStaysInsideTheGameFolder(t *testing.T) {
	g := game(t)
	h := handler(g, "C")
	for _, p := range []string{"../XEW", "Config/../../x", "/etc/passwd", "C:/Windows/win.ini", `..\x`, ""} {
		if w := call(h, "GET", "/v1/file?path="+p, site, "C", ""); w.Code != http.StatusBadRequest {
			t.Errorf("%q: %d", p, w.Code)
		}
	}
}

func TestWritesListsAndRemoves(t *testing.T) {
	g := game(t)
	h := handler(g, "C")
	if w := call(h, "PUT", "/v1/file?path=lwtree-backup/Config/DefaultGameCore.ini", site, "C", "A=1\r\n"); w.Code != http.StatusNoContent {
		t.Fatalf("write: %d %s", w.Code, w.Body.String())
	}
	if w := call(h, "PUT", "/v1/file?path=Config/DefaultGameCore.ini", site, "C", "A=2\r\n"); w.Code != http.StatusNoContent {
		t.Fatalf("replace: %d", w.Code)
	}
	if b, _ := os.ReadFile(filepath.Join(g, "Config", "DefaultGameCore.ini")); string(b) != "A=2\r\n" {
		t.Errorf("replaced file: %q", b)
	}
	if b, _ := os.ReadFile(filepath.Join(g, "lwtree-backup", "Config", "DefaultGameCore.ini")); string(b) != "A=1\r\n" {
		t.Errorf("backup: %q", b)
	}
	w := call(h, "GET", "/v1/list?path=Config", site, "C", "")
	if strings.TrimSpace(w.Body.String()) != `["DefaultGameCore.ini"]` {
		t.Errorf("list (no temp files left): %s", w.Body.String())
	}
	if w := call(h, "DELETE", "/v1/file?path=lwtree-backup/Config/DefaultGameCore.ini", site, "C", ""); w.Code != http.StatusNoContent {
		t.Errorf("remove: %d", w.Code)
	}
	if w := call(h, "GET", "/v1/file?path=lwtree-backup/Config/DefaultGameCore.ini", site, "C", ""); w.Code != http.StatusNotFound {
		t.Errorf("removed file still there: %d", w.Code)
	}
}

func TestPrefersEnemyWithinOverEnemyUnknown(t *testing.T) {
	g := game(t)
	steam := filepath.Dir(filepath.Dir(g)) // XCom-Enemy-Unknown
	for _, d := range []string{"CookedPCConsole", "Config"} {
		if err := os.MkdirAll(filepath.Join(steam, "XComGame", d), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	if got, _ := findGame(steam, func(string) {}); got != g {
		t.Errorf("findGame(game folder) = %s, want XEW's %s", got, g)
	}
}

func TestReadsSteamsPlaceFromTheRegistry(t *testing.T) {
	out := "\r\nHKEY_CURRENT_USER\\Software\\Valve\\Steam\r\n    SteamPath    REG_SZ    i:/steam\r\n\r\n"
	if got := regValue(out, "SteamPath"); got != filepath.FromSlash("i:/steam") {
		t.Errorf("regValue = %q", got)
	}
	if got := regValue("    InstallPath    REG_SZ    C:\\Program Files (x86)\\Steam\r\n", "InstallPath"); got != `C:\Program Files (x86)\Steam` {
		t.Errorf("regValue with spaces = %q", got)
	}
}

func TestFindsTheLibraryThatHoldsTheGame(t *testing.T) {
	steam := t.TempDir()
	if err := os.MkdirAll(filepath.Join(steam, "steamapps"), 0o755); err != nil {
		t.Fatal(err)
	}
	vdf := `"libraryfolders"
{
	"0"
	{
		"path"		"C:\\Program Files (x86)\\Steam"
		"apps"
		{
			"228980"		"123"
		}
	}
	"1"
	{
		"path"		"I:\\Games\\Steam"
		"apps"
		{
			"200510"		"456"
			"225340"		"7"
		}
	}
}`
	if err := os.WriteFile(filepath.Join(steam, "steamapps", "libraryfolders.vdf"), []byte(vdf), 0o644); err != nil {
		t.Fatal(err)
	}
	got := libraryOfApp(steam, "200510")
	if len(got) != 2 || got[0] != `I:\Games\Steam` {
		t.Errorf("libraryOfApp = %q", got)
	}
}
