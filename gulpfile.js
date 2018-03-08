var gulp = require('gulp'),
  run = require('gulp-run');

gulp.task('default', ['tsc', 'config']);

gulp.task('tsc', function() {
  return run('tsc').exec();
});

gulp.task('config', function () {
  gulp.src('./src/config.json') 
    .pipe(gulp.dest('dist/server'));
});
