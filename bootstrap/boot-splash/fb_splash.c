#define _POSIX_C_SOURCE 200809L
#include <errno.h>
#include <fcntl.h>
#include <linux/fb.h>
#include <poll.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>

/* Minimal early-boot RGB565 framebuffer renderer. No codec or service dependency. */
#define SRC_W 1280U
#define SRC_H 720U
#define FRAME_BYTES (SRC_W * SRC_H * 2U)
#define FRAME_INTERVAL_NS 41666667L
static volatile sig_atomic_t stopped;
static void on_stop(int sig) {(void)sig; stopped=1;}
static uint32_t convert_color(uint16_t p, const struct fb_var_screeninfo *v) {
    const uint32_t r = (p >> 11) & 31, g = (p >> 5) & 63, b = p & 31;
    return ((r * ((1U << v->red.length) - 1U) / 31U) << v->red.offset)
         | ((g * ((1U << v->green.length) - 1U) / 63U) << v->green.offset)
         | ((b * ((1U << v->blue.length) - 1U) / 31U) << v->blue.offset);
}
static int read_exact(uint8_t *buf, size_t n) {
    size_t pos = 0;
    while(pos < n && !stopped) {
        ssize_t got = read(STDIN_FILENO, buf+pos, n-pos);
        if(got < 0 && errno==EINTR) continue;
        if(got <= 0) return (pos==0 && got==0) ? 0 : -1;
        pos += (size_t)got;
    }
    return stopped ? 0 : 1;
}
static int consume_stop(int fifo_fd) {
    if (stopped) return 1;
    if (fifo_fd < 0) return 0;
    struct pollfd p = {.fd=fifo_fd, .events=POLLIN};
    if (poll(&p,1,0) > 0 && (p.revents&POLLIN)) {
        char cmd[16];
        if (read(fifo_fd,cmd,sizeof(cmd))>0) return 1;
    }
    return 0;
}
static int target_supported(const struct fb_fix_screeninfo *f,const struct fb_var_screeninfo *v) {
    return f->type==FB_TYPE_PACKED_PIXELS && f->visual==FB_VISUAL_TRUECOLOR &&
        (v->bits_per_pixel==16||v->bits_per_pixel==24||v->bits_per_pixel==32) &&
        v->red.length>0 && v->red.length<=8 && v->green.length>0 &&
        v->green.length<=8 && v->blue.length>0 && v->blue.length<=8 &&
        v->xres>0 && v->yres>0 && v->xres<=8192 && v->yres<=8192 &&
        f->line_length >= v->xres*(v->bits_per_pixel/8);
}
static void draw(uint8_t *fb,size_t mapped,const struct fb_fix_screeninfo *f,
                 const struct fb_var_screeninfo *v,const uint8_t *frame) {
    const size_t pxbytes=v->bits_per_pixel/8;
    for(uint32_t y=0;y<v->yres;y++) {
        uint32_t sy=(uint64_t)y*SRC_H/v->yres;
        size_t row=(size_t)(y+v->yoffset)*f->line_length;
        if(row + (size_t)(v->xoffset+v->xres)*pxbytes > mapped) break;
        for(uint32_t x=0;x<v->xres;x++) {
            uint32_t sx=(uint64_t)x*SRC_W/v->xres;
            size_t i=((size_t)sy*SRC_W+sx)*2;
            uint16_t pixel=(uint16_t)frame[i] | (uint16_t)frame[i+1]<<8;
            uint32_t native=convert_color(pixel,v);
            uint8_t *dst=fb+row+(v->xoffset+x)*pxbytes;
            for(size_t k=0;k<pxbytes;k++) dst[k]=(uint8_t)(native>>(k*8));
        }
    }
}
static void tick(struct timespec *deadline) {
    deadline->tv_nsec+=FRAME_INTERVAL_NS;
    if(deadline->tv_nsec>=1000000000L) { deadline->tv_sec++;deadline->tv_nsec-=1000000000L; }
    while(!stopped && clock_nanosleep(CLOCK_MONOTONIC,TIMER_ABSTIME,deadline,NULL)==EINTR) {}
}
int main(int argc,char **argv) {
    int verify=0; const char *fbpath="/dev/fb0", *control=NULL;
    for(int i=1;i<argc;i++) {
        if(!strcmp(argv[i],"--verify-stream")) verify=1;
        else if(!strcmp(argv[i],"--framebuffer") && ++i<argc) fbpath=argv[i];
        else if(!strcmp(argv[i],"--control-fifo") && ++i<argc) control=argv[i];
        else { fprintf(stderr,"unsupported splash argument\n");return 2; }
    }
    struct sigaction sa={.sa_handler=on_stop}; sigemptyset(&sa.sa_mask);
    sigaction(SIGTERM,&sa,NULL);sigaction(SIGINT,&sa,NULL);
    uint8_t *frame=malloc(FRAME_BYTES);if(!frame) return 2;
    int fbfd=-1,fd=-1;uint8_t *pixels=MAP_FAILED;size_t mapsize=0;
    struct fb_fix_screeninfo fix={0}; struct fb_var_screeninfo var={0};
    if(!verify) {
        fbfd=open(fbpath,O_RDWR|O_CLOEXEC|O_NOFOLLOW);
        if(fbfd<0||ioctl(fbfd,FBIOGET_FSCREENINFO,&fix)||ioctl(fbfd,FBIOGET_VSCREENINFO,&var)||!target_supported(&fix,&var)||
          fix.smem_len>512U*1024U*1024U||!fix.smem_len) {fprintf(stderr,"framebuffer unavailable/unsupported\n");free(frame);if(fbfd>=0)close(fbfd);return 3;}
        mapsize=fix.smem_len;
        pixels=mmap(NULL,mapsize,PROT_READ|PROT_WRITE,MAP_SHARED,fbfd,0);
        if(pixels==MAP_FAILED){perror("mmap");free(frame);close(fbfd);return 3;}
    }
    if(control) {
        struct stat st;
        if(lstat(control,&st)||!S_ISFIFO(st.st_mode)) {fprintf(stderr,"control must be FIFO\n");return 4;}
        fd=open(control,O_RDONLY|O_NONBLOCK|O_CLOEXEC|O_NOFOLLOW);
        if(fd<0) {perror("fifo");return 4;}
    }
    struct timespec next;clock_gettime(CLOCK_MONOTONIC,&next);
    unsigned long count=0;int rc=0;
    while(!consume_stop(fd)) {
        int got=read_exact(frame,FRAME_BYTES);
        if(got==0)break;
        if(got<0){fprintf(stderr,"invalid partial RGB565 frame\n");rc=5;break;}
        if(!verify){draw(pixels,mapsize,&fix,&var,frame);tick(&next);}
        count++;
        if(count>300){fprintf(stderr,"animation frame limit exceeded\n");rc=6;break;}
    }
    if(verify&&count==0){fprintf(stderr,"empty frame stream\n");rc=7;}
    if(verify&&rc==0)printf("ORDAX_BOOT_FRAME_STREAM=PASS frames=%lu\n",count);
    if(fd>=0)close(fd);
    if(pixels!=MAP_FAILED)munmap(pixels,mapsize);
    if(fbfd>=0)close(fbfd);
    free(frame);
    return rc;
}
