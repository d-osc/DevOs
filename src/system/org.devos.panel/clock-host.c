/* GLib date/time ABI for the data interpreter. No GTK or presentation policy. */
#include <glib.h>
#include <stdint.h>
#include <string.h>
#include <locale.h>
void pc_locale(void){setlocale(LC_TIME,"");}
int64_t pc_now(void){return g_get_real_time()/G_USEC_PER_SEC;}
void *pc_date(int64_t stamp){return g_date_time_new_from_unix_local(stamp);}
unsigned char *pc_format(void *date,const char *format){return (unsigned char *)g_date_time_format(date,format);}
void pc_unref(void *date){g_date_time_unref(date);}
void pc_free(void *value){g_free(value);}
size_t pc_length(const unsigned char *value){return strlen((const char *)value);}
