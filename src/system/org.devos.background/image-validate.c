/* Image codec ABI only. Apply policy and file ownership live in DevLang. */
#include <gdk-pixbuf/gdk-pixbuf.h>
#include <stdint.h>
int32_t bg_validate_image(const char *path){
    GError *error=NULL;GdkPixbuf *image=gdk_pixbuf_new_from_file_at_scale(path,4096,4096,TRUE,&error);
    if(error){g_error_free(error);}if(!image)return 0;g_object_unref(image);return 1;
}
