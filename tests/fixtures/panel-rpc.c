#include <stdio.h>
#include <stdlib.h>
#include <string.h>
void *sp_builder(void){return calloc(256,1);}
void sp_arg(void *builder,const char *value){snprintf(builder,256,"%s",value);}
int sr_remote(const char *name,const char *path,const char *interface_name,const char *method,void *builder,const char *cwd){
    (void)name;(void)path;(void)interface_name;(void)method;(void)cwd;
    FILE *file=fopen(getenv("PANEL_RPC_LOG"),"a");if(!file){free(builder);return 1;}fprintf(file,"%s\n",(char *)builder);fclose(file);free(builder);
    const char *failed=getenv("PANEL_RPC_FAIL");return failed && strcmp(failed,"1")==0;
}
