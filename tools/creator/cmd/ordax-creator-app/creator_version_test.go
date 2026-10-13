package main
import "testing"
func TestCreatorProductVersion(t *testing.T) {
 for _, s := range []string{"0.6.0-dev","1.0.0","1.0.0-rc.2"} {if !validCreatorVersion(s){t.Fatalf("valid version rejected: %q",s)}}
 for _, s := range []string{"","owner-2bad2d125d7e","../1.0.0","1.0","1.2.3\n","V1.0.0"} {if validCreatorVersion(s){t.Fatalf("invalid version accepted: %q",s)}}
}
